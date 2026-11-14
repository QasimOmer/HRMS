import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { PERMISSIONS as P, surveyResponseSchema, surveySchema, type SurveyInput } from '@hrms/shared';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { currentUser } from '../../common/context';
import { hmac } from '../../common/crypto';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { one, requireDelete, assertUnused, countWhere } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { NotificationsService } from '../../core/notifications.service';
import { DbService } from '../../db/db.service';
import {
  employees,
  surveyResponses,
  surveys,
  teamMembers,
  type SurveyQuestion,
} from '../../db/schema';

/** E3 performance surveys & F7 team/department surveys. */
@RequireModule('COMPLIANCE')
@Controller('surveys')
export class SurveysController {
  constructor(
    private readonly db: DbService,
    private readonly notify: NotificationsService,
  ) {}

  private async canManage(s: typeof surveys.$inferSelect) {
    const u = currentUser();
    if (u.permissions.has(P.SURVEYS_MANAGE)) return true; // HR can access, review and edit TL surveys (F7)
    return u.permissions.has(P.SURVEYS_MANAGE_TEAM) && s.createdByUserId === u.userId;
  }

  private validateAudience(body: SurveyInput) {
    const u = currentUser();
    if (u.permissions.has(P.SURVEYS_MANAGE)) return;
    if (body.audience !== 'TEAM' || !body.audienceId || !u.ledTeamIds.includes(body.audienceId)) {
      throw forbidden('Team Leads can create surveys for their own teams only');
    }
  }

  private async audienceEmployeeIds(s: typeof surveys.$inferSelect): Promise<string[]> {
    const tx = this.db.tx;
    if (s.audience === 'TEAM' && s.audienceId) {
      return (await tx.select({ id: teamMembers.employeeId }).from(teamMembers).where(eq(teamMembers.teamId, s.audienceId))).map((r) => r.id);
    }
    const q = tx.select({ id: employees.id }).from(employees);
    const rows = s.audience === 'DEPARTMENT' && s.audienceId
      ? await q.where(and(eq(employees.departmentId, s.audienceId), eq(employees.employmentStatus, 'ACTIVE')))
      : await q.where(eq(employees.employmentStatus, 'ACTIVE'));
    return rows.map((r) => r.id);
  }

  @Get('manage')
  @RequireAny(P.SURVEYS_MANAGE, P.SURVEYS_MANAGE_TEAM)
  async manage() {
    const u = currentUser();
    const base = this.db.tx
      .select({ s: surveys, responses: sql<number>`(select count(*)::int from survey_responses r where r.survey_id = ${surveys.id})` })
      .from(surveys);
    const rows = u.permissions.has(P.SURVEYS_MANAGE)
      ? await base.orderBy(desc(surveys.createdAt))
      : await base.where(eq(surveys.createdByUserId, u.userId)).orderBy(desc(surveys.createdAt));
    return rows.map((r) => ({ ...r.s, responses: r.responses }));
  }

  /** Open surveys addressed to me that I haven't answered yet. */
  @Get('available')
  async available() {
    const u = currentUser();
    if (!u.employeeId) return [];
    const tx = this.db.tx;
    const [emp] = await tx.select().from(employees).where(eq(employees.id, u.employeeId));
    const [team] = await tx.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.employeeId, u.employeeId));
    const rows = await tx
      .select()
      .from(surveys)
      .where(
        and(
          eq(surveys.status, 'OPEN'),
          or(
            eq(surveys.audience, 'ALL'),
            and(eq(surveys.audience, 'DEPARTMENT'), eq(surveys.audienceId, emp!.departmentId)),
            team ? and(eq(surveys.audience, 'TEAM'), eq(surveys.audienceId, team.teamId)) : sql`false`,
          ),
        ),
      )
      .orderBy(desc(surveys.createdAt));
    if (!rows.length) return [];
    const answered = await tx
      .select({ surveyId: surveyResponses.surveyId })
      .from(surveyResponses)
      .where(and(inArray(surveyResponses.surveyId, rows.map((r) => r.id)), inArray(surveyResponses.respondentKey, rows.map((r) => hmac(`${r.id}:${u.employeeId}`)))));
    const done = new Set(answered.map((a) => a.surveyId));
    return rows.filter((r) => !done.has(r.id) && r.subjectEmployeeId !== u.employeeId);
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (await this.canManage(s)) return s;
    const u = currentUser();
    if (s.status !== 'OPEN' || !u.employeeId || !(await this.audienceEmployeeIds(s)).includes(u.employeeId)) throw forbidden();
    return s;
  }

  @Post()
  @RequireAny(P.SURVEYS_MANAGE, P.SURVEYS_MANAGE_TEAM)
  @Audit('survey.created', 'survey')
  async create(@Body(zp(surveySchema)) body: SurveyInput) {
    this.validateAudience(body);
    const u = currentUser();
    return one(await this.db.tx.insert(surveys).values({ ...body, questions: body.questions as SurveyQuestion[], tenantId: u.tenantId, createdByUserId: u.userId }).returning());
  }

  @Put(':id')
  @Audit('survey.updated', 'survey')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(surveySchema)) body: SurveyInput) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (!(await this.canManage(s))) throw forbidden();
    this.validateAudience(body);
    const [{ n }] = (await this.db.tx.select({ n: sql<number>`count(*)::int` }).from(surveyResponses).where(eq(surveyResponses.surveyId, id))) as [{ n: number }];
    if (n > 0 && JSON.stringify(s.questions) !== JSON.stringify(body.questions)) throw badRequest('Questions cannot change after responses were received');
    return one(await this.db.tx.update(surveys).set({ ...body, questions: body.questions as SurveyQuestion[] }).where(eq(surveys.id, id)).returning());
  }

  /** Deletes the survey and its responses. */
  @Delete(':id')
  @Audit('survey.deleted', 'survey')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (!(await this.canManage(s))) throw forbidden();
    requireDelete();
    await this.db.tx.delete(surveys).where(eq(surveys.id, id));
    return { id, deleted: true };
  }

  @Post(':id/open')
  @Audit('survey.opened', 'survey')
  async open(@Param('id', ParseUUIDPipe) id: string) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (!(await this.canManage(s))) throw forbidden();
    await this.db.tx.update(surveys).set({ status: 'OPEN' }).where(eq(surveys.id, id));
    await this.notify.notifyEmployees(await this.audienceEmployeeIds(s), { type: 'survey.opened', title: `New survey: ${s.title}`, link: `/surveys/${s.id}/respond` });
    return { id, status: 'OPEN' };
  }

  @Post(':id/close')
  @Audit('survey.closed', 'survey')
  async close(@Param('id', ParseUUIDPipe) id: string) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (!(await this.canManage(s))) throw forbidden();
    await this.db.tx.update(surveys).set({ status: 'CLOSED' }).where(eq(surveys.id, id));
    return { id, status: 'CLOSED' };
  }

  @Post(':id/responses')
  @Audit('survey.responded', 'survey')
  async respond(@Param('id', ParseUUIDPipe) id: string, @Body(zp(surveyResponseSchema)) body: z.infer<typeof surveyResponseSchema>) {
    const u = currentUser();
    if (!u.employeeId) throw forbidden();
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (s.status !== 'OPEN') throw badRequest('This survey is not open');
    if (!(await this.audienceEmployeeIds(s)).includes(u.employeeId)) throw forbidden();
    const answers: Record<string, unknown> = {};
    for (const q of s.questions) {
      const a = body.answers[q.id];
      const empty = a === undefined || a === '' || (Array.isArray(a) && a.length === 0);
      if (empty) {
        if (q.required) throw badRequest(`Please answer: ${q.label}`);
        continue;
      }
      if (q.type === 'RATING' && (typeof a !== 'number' || a < 1 || a > 5)) throw badRequest(`Rating must be 1–5: ${q.label}`);
      if (q.type === 'SINGLE_CHOICE' && (typeof a !== 'string' || !q.options?.includes(a))) throw badRequest(`Invalid choice: ${q.label}`);
      if (q.type === 'MULTI_CHOICE' && (!Array.isArray(a) || a.some((x) => !q.options?.includes(x)))) throw badRequest(`Invalid choice: ${q.label}`);
      if (q.type === 'TEXT' && typeof a !== 'string') throw badRequest(`Text expected: ${q.label}`);
      answers[q.id] = a;
    }
    await this.db.tx.insert(surveyResponses).values({
      tenantId: u.tenantId,
      surveyId: id,
      respondentKey: hmac(`${id}:${u.employeeId}`),
      respondentEmployeeId: s.anonymous ? null : u.employeeId,
      answers,
    });
    return { ok: true };
  }

  @Get(':id/results')
  async results(@Param('id', ParseUUIDPipe) id: string) {
    const s = one(await this.db.tx.select().from(surveys).where(eq(surveys.id, id)), 'Survey');
    if (!(await this.canManage(s))) throw forbidden();
    const rows = await this.db.tx
      .select({ r: surveyResponses, fullName: employees.fullName })
      .from(surveyResponses)
      .leftJoin(employees, eq(employees.id, surveyResponses.respondentEmployeeId))
      .where(eq(surveyResponses.surveyId, id))
      .orderBy(desc(surveyResponses.createdAt));
    const audience = (await this.audienceEmployeeIds(s)).length;
    const questions = s.questions.map((q) => {
      const vals = rows.map((r) => r.r.answers[q.id]).filter((v) => v !== undefined);
      if (q.type === 'RATING') {
        const nums = vals as number[];
        const dist = [1, 2, 3, 4, 5].map((n) => nums.filter((v) => v === n).length);
        return { ...q, count: nums.length, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null, distribution: dist };
      }
      if (q.type === 'SINGLE_CHOICE' || q.type === 'MULTI_CHOICE') {
        const flat = vals.flatMap((v) => (Array.isArray(v) ? v : [v])) as string[];
        return { ...q, count: vals.length, options: (q.options ?? []).map((o) => ({ option: o, count: flat.filter((v) => v === o).length })) };
      }
      return {
        ...q,
        count: vals.length,
        answers: rows.filter((r) => r.r.answers[q.id] !== undefined).map((r) => ({ text: r.r.answers[q.id] as string, by: s.anonymous ? null : r.fullName })),
      };
    });
    return { survey: s, responses: rows.length, audience, questions };
  }
}
