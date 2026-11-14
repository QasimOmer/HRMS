import { Body, Controller, Delete, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { config } from '../../config';
import { StorageService, type UploadedFileLike } from '../../core/storage.service';
import { PERMISSIONS as P, kpiDecisionSchema, kpiSubmissionSchema, kpiTargetSchema } from '@hrms/shared';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '../../common/context';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { one, round2, scoped, requireDelete, assertUnused, countWhere } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ApprovalsService } from '../../core/approvals.service';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { DbService } from '../../db/db.service';
import {
  employees,
  incentives,
  kpiSubmissions,
  kpiTargets,
} from '../../db/schema';

const listQuery = z.object({
  employeeId: z.uuid().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  mine: z.coerce.boolean().optional(),
});

/** E2: incentive when the assigned target is exceeded. */
export function incentiveFor(target: { targetValue: number; incentiveType: 'FIXED' | 'PERCENT_OF_EXCESS'; incentiveValue: number }, achieved: number): number {
  if (achieved <= target.targetValue || target.incentiveValue <= 0) return 0;
  return round2(target.incentiveType === 'FIXED' ? target.incentiveValue : ((achieved - target.targetValue) * target.incentiveValue) / 100);
}

/** E1–E2 – KPI targets, submissions (Team Lead → HR) and incentives. */
@RequireModule('PERFORMANCE')
@Controller('kpi')
export class PerformanceController {
  constructor(
    private readonly db: DbService,
    private readonly approvals: ApprovalsService,
    private readonly scope: ScopeService,
    private readonly notify: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private async visible(q: { employeeId?: string; mine?: boolean }) {
    if (q.mine) return [this.scope.requireEmployee()];
    const ids = await this.scope.visibleEmployeeIds(P.KPI_APPROVE_HR, P.KPI_APPROVE_TL);
    if (q.employeeId) {
      if (ids && !ids.includes(q.employeeId)) throw forbidden();
      return [q.employeeId];
    }
    return ids;
  }

  @Get('targets')
  async targets(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    const ids = await this.visible(q);
    const conds: SQL[] = [];
    const s = scoped(kpiTargets.employeeId, ids);
    if (s) conds.push(s);
    if (q.period) conds.push(eq(kpiTargets.period, q.period));
    const rows = await this.db.tx
      .select({
        t: kpiTargets,
        fullName: employees.fullName,
        achieved: sql<number | null>`(select max(achieved_value)::float from kpi_submissions s where s.target_id = ${kpiTargets.id} and s.status <> 'REJECTED' and s.status <> 'CANCELLED')`,
      })
      .from(kpiTargets)
      .innerJoin(employees, eq(employees.id, kpiTargets.employeeId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(kpiTargets.period))
      .limit(500);
    return rows.map((r) => ({ ...r.t, fullName: r.fullName, achieved: r.achieved, progress: r.achieved != null && r.t.targetValue > 0 ? round2((r.achieved / r.t.targetValue) * 100) : null }));
  }

  @Post('targets')
  @RequireAny(P.KPI_TARGETS_MANAGE, P.KPI_APPROVE_TL)
  @Audit('kpi.target_set', 'kpi_target')
  async setTarget(@Body(zp(kpiTargetSchema)) body: z.infer<typeof kpiTargetSchema>) {
    const u = currentUser();
    if (!u.permissions.has(P.KPI_TARGETS_MANAGE) && !(await this.scope.isTeamLeadOf(body.employeeId))) throw forbidden('You can set targets for your team only');
    const row = one(await this.db.tx.insert(kpiTargets).values({ ...body, tenantId: u.tenantId, createdByUserId: u.userId }).returning());
    await this.notify.notifyEmployees([body.employeeId], { type: 'kpi.target_set', title: `New ${body.metric} target for ${body.period}`, link: '/kpi' });
    return row;
  }

  @Delete('targets/:id')
  @RequireAny(P.KPI_TARGETS_MANAGE)
  @Audit('kpi.target_deleted', 'kpi_target')
  async removeTarget(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: kpiTargets.id }).from(kpiTargets).where(eq(kpiTargets.id, id)), 'KPI target');
    assertUnused('This KPI target', [[await countWhere(tx, kpiSubmissions, eq(kpiSubmissions.targetId, id)), 'submission(s)']]);
    await tx.delete(kpiTargets).where(eq(kpiTargets.id, id));
    return { id, deleted: true };
  }

  @Get('submissions')
  async submissions(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    const u = currentUser();
    const ids = await this.visible(q);
    const conds: SQL[] = [];
    const s = scoped(kpiSubmissions.employeeId, ids);
    if (s) conds.push(s);
    if (q.period) conds.push(eq(kpiSubmissions.period, q.period));
    if (q.status) conds.push(eq(kpiSubmissions.status, q.status));
    const rows = await this.db.tx
      .select({ s: kpiSubmissions, fullName: employees.fullName, targetValue: kpiTargets.targetValue, unit: kpiTargets.unit })
      .from(kpiSubmissions)
      .innerJoin(employees, eq(employees.id, kpiSubmissions.employeeId))
      .leftJoin(kpiTargets, eq(kpiTargets.id, kpiSubmissions.targetId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(kpiSubmissions.createdAt))
      .limit(500);
    return Promise.all(rows.map(async (r) => ({ ...r.s, fullName: r.fullName, targetValue: r.targetValue, unit: r.unit, canDecide: r.s.employeeId !== u.employeeId && (await this.approvals.canDecide('KPI', r.s)) })));
  }

  /** Results with optional proof of the work done (up to 5 files: reports, screenshots, PDFs). */
  @Post('submissions')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: config().MAX_UPLOAD_MB * 1024 * 1024 } }))
  @Audit('kpi.submitted', 'kpi_submission')
  async submit(@UploadedFiles() files: UploadedFileLike[] | undefined, @Body(zp(kpiSubmissionSchema)) body: z.infer<typeof kpiSubmissionSchema>) {
    const employeeId = this.scope.requireEmployee();
    const tx = this.db.tx;
    if (body.targetId) {
      const t = one(await tx.select().from(kpiTargets).where(eq(kpiTargets.id, body.targetId)), 'Target');
      if (t.employeeId !== employeeId) throw forbidden();
      if (t.period !== body.period) throw badRequest('Period does not match the target');
      const [open] = await tx.select({ id: kpiSubmissions.id }).from(kpiSubmissions).where(and(eq(kpiSubmissions.targetId, body.targetId), inArray(kpiSubmissions.status, ['PENDING', 'APPROVED'])));
      if (open) throw badRequest('You already submitted results for this target');
    }
    const fileIds: string[] = [];
    for (const f of files ?? []) fileIds.push((await this.storage.save(f, 'document')).id);
    const row = one(await tx.insert(kpiSubmissions).values({ tenantId: currentUser().tenantId, employeeId, ...body, fileIds }).returning());
    const wf = await this.approvals.submit('KPI', row.id, employeeId, { title: `KPI submission (${body.metric}, ${body.period})`, link: '/kpi' });
    await tx.update(kpiSubmissions).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(kpiSubmissions.id, row.id));
    if (wf.status === 'APPROVED') await this.grantIncentive(row.id);
    return { ...row, status: wf.status, currentStep: wf.currentStep };
  }

  /** Proof files: the submitter, and anyone who can review their KPIs (Team Lead / HR). */
  @Get('submissions/:id/files/:index')
  async submissionFile(@Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    const s = one(await this.db.tx.select().from(kpiSubmissions).where(eq(kpiSubmissions.id, id)), 'Submission');
    if (s.employeeId !== currentUser().employeeId) {
      const ids = await this.scope.visibleEmployeeIds(P.KPI_APPROVE_HR, P.KPI_APPROVE_TL);
      if (ids && !ids.includes(s.employeeId)) throw forbidden();
    }
    const fileId = s.fileIds[index];
    if (!fileId) throw badRequest('No such file');
    return this.storage.stream(fileId, 'inline');
  }

  @Post('submissions/:id/decision')
  @Audit('kpi.decided', 'kpi_submission')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body(zp(kpiDecisionSchema)) body: z.infer<typeof kpiDecisionSchema>) {
    const tx = this.db.tx;
    const s = one(await tx.select().from(kpiSubmissions).where(eq(kpiSubmissions.id, id)), 'KPI submission');
    const step = s.currentStep;
    const wf = await this.approvals.decide('KPI', s, body.approve, body.remarks, { title: `KPI submission (${s.metric}, ${s.period})`, link: '/kpi' });
    await tx
      .update(kpiSubmissions)
      .set({ status: wf.status, currentStep: wf.currentStep, ...(step === 'TEAM_LEAD' ? { tlRemarks: body.remarks } : { hrRemarks: body.remarks }) })
      .where(eq(kpiSubmissions.id, id));
    if (wf.status === 'APPROVED') await this.grantIncentive(id);
    return { id, status: wf.status, currentStep: wf.currentStep };
  }

  private async grantIncentive(submissionId: string) {
    const tx = this.db.tx;
    const s = one(await tx.select().from(kpiSubmissions).where(eq(kpiSubmissions.id, submissionId)));
    if (!s.targetId) return;
    const t = one(await tx.select().from(kpiTargets).where(eq(kpiTargets.id, s.targetId)));
    const amount = incentiveFor(t, s.achievedValue);
    if (amount <= 0) return;
    await tx.insert(incentives).values({ tenantId: s.tenantId, employeeId: s.employeeId, kpiSubmissionId: s.id, period: s.period, amount });
    await this.notify.notifyEmployees([s.employeeId], { type: 'incentive.earned', title: `You earned an incentive of ${amount} for exceeding your ${s.metric} target`, link: '/kpi' });
  }

  /** Performance history (E1): submissions + incentives for one employee. */
  @Get('history/:employeeId')
  async history(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    const u = currentUser();
    if (u.employeeId !== employeeId) await this.scope.assertCanView(employeeId, P.KPI_APPROVE_HR, P.KPI_APPROVE_TL);
    const [subs, incs] = await Promise.all([
      this.db.tx.select().from(kpiSubmissions).where(eq(kpiSubmissions.employeeId, employeeId)).orderBy(desc(kpiSubmissions.period)),
      this.db.tx.select().from(incentives).where(eq(incentives.employeeId, employeeId)).orderBy(desc(incentives.period)),
    ]);
    return { submissions: subs, incentives: incs };
  }

  @Get('incentives')
  async incentives(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    const u = currentUser();
    const ids = q.mine || !u.permissions.has(P.INCENTIVES_MANAGE) ? [this.scope.requireEmployee()] : null;
    return this.db.tx
      .select({ i: incentives, fullName: employees.fullName })
      .from(incentives)
      .innerJoin(employees, eq(employees.id, incentives.employeeId))
      .where(scoped(incentives.employeeId, ids))
      .orderBy(desc(incentives.createdAt))
      .limit(500)
      .then((r) => r.map((x) => ({ ...x.i, fullName: x.fullName })));
  }

  @Post('incentives/:id/void')
  @RequireAny(P.INCENTIVES_MANAGE)
  @Audit('incentive.voided', 'incentive')
  async voidIncentive(@Param('id', ParseUUIDPipe) id: string) {
    const i = one(await this.db.tx.select().from(incentives).where(eq(incentives.id, id)), 'Incentive');
    if (i.status === 'PAID') throw badRequest('Paid incentives cannot be voided');
    await this.db.tx.update(incentives).set({ status: 'VOID' }).where(eq(incentives.id, id));
    return { id, status: 'VOID' };
  }
}
