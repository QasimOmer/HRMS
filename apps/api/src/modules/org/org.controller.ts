import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS as P,
  addTeamMemberSchema,
  companyEmailDomains,
  decision,
  departmentSchema,
  levelSchema,
  reorderLevelsSchema,
  teamSchema,
  tenantSettingsSchema,
  workScheduleSchema,
  type DecisionInput,
  type DepartmentInput,
  type TenantSettingsInput,
  type WorkScheduleInput,
} from '@hrms/shared';
import { and, asc, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '../../common/context';
import { Audit, RequireAny } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { inIds, one, requireDelete, assertUnused, countWhere, deleteSafely } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ApprovalsService } from '../../core/approvals.service';
import { NotificationsService } from '../../core/notifications.service';
import { DbService } from '../../db/db.service';
import {
  departments,
  employees,
  levels,
  teamMembers,
  teamTransferRequests,
  teams,
  tenants,
  userRoles,
  workSchedules,
  employeePositions,
  foodAllowanceRules,
} from '../../db/schema';

const levelUpdate = z.object({
  title: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
  defaultSalary: z.coerce.number().min(0).optional(),
  minSalary: z.coerce.number().min(0).nullable().optional(),
  maxSalary: z.coerce.number().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
});

@Controller()
export class OrgController {
  constructor(
    private readonly db: DbService,
    private readonly approvals: ApprovalsService,
    private readonly notify: NotificationsService,
  ) {}

  /* ---------------- Tenant settings ---------------- */

  @Get('settings')
  async settings() {
    const [t] = await this.db.tx.select().from(tenants).where(eq(tenants.id, currentUser().tenantId));
    return { name: t!.name, slug: t!.slug, timezone: t!.timezone, currency: t!.currency, logoFileId: t!.logoFileId, emailDomain: t!.emailDomain, emailDomains: companyEmailDomains(t!), settings: t!.settings };
  }

  @Patch('settings')
  @RequireAny(P.TENANT_SETTINGS, P.DIRECTORY_SETTINGS)
  @Audit('settings.updated', 'tenant')
  async updateSettings(@Body(zp(tenantSettingsSchema)) body: TenantSettingsInput) {
    const user = currentUser();
    const full = user.permissions.has(P.TENANT_SETTINGS);
    // Operations may only toggle the directory join-date display (B5) and set the session timeout (SEC-03).
    const OPS_KEYS = ['directoryShowJoinDate', 'sessionIdleMinutes'];
    if (!full && Object.keys(body).some((k) => !OPS_KEYS.includes(k))) throw forbidden();
    const tx = this.db.tx;
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, user.tenantId));
    const { name, timezone, currency, ...rest } = body;
    const settings = { ...t!.settings, ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
    await tx
      .update(tenants)
      .set({ name: name ?? t!.name, timezone: timezone ?? t!.timezone, currency: currency ?? t!.currency, settings })
      .where(eq(tenants.id, user.tenantId));
    return this.settings();
  }

  /* ---------------- Work schedules (C5 default working timelines) ---------------- */

  @Get('work-schedules')
  workSchedules() {
    return this.db.tx.select().from(workSchedules).orderBy(desc(workSchedules.isDefault), asc(workSchedules.name));
  }

  @Post('work-schedules')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('work_schedule.created', 'work_schedule')
  async createSchedule(@Body(zp(workScheduleSchema)) body: WorkScheduleInput) {
    const tx = this.db.tx;
    if (body.isDefault) await tx.update(workSchedules).set({ isDefault: false });
    return one(await tx.insert(workSchedules).values({ ...body, tenantId: currentUser().tenantId }).returning());
  }

  @Put('work-schedules/:id')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('work_schedule.updated', 'work_schedule')
  async updateSchedule(@Param('id', ParseUUIDPipe) id: string, @Body(zp(workScheduleSchema)) body: WorkScheduleInput) {
    const tx = this.db.tx;
    if (body.isDefault) await tx.update(workSchedules).set({ isDefault: false }).where(ne(workSchedules.id, id));
    return one(await tx.update(workSchedules).set(body).where(eq(workSchedules.id, id)).returning(), 'Work schedule');
  }

  @Delete('work-schedules/:id')
  @RequireAny(P.TENANT_SETTINGS, P.ATTENDANCE_MANAGE)
  @Audit('work_schedule.deleted', 'work_schedule')
  async removeSchedule(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    const ws = one(await tx.select().from(workSchedules).where(eq(workSchedules.id, id)), 'Schedule');
    if (ws.isDefault) throw badRequest('Make another schedule the default before deleting this one', 'IS_DEFAULT');
    assertUnused('This schedule', [
      [await countWhere(tx, employees, eq(employees.workScheduleId, id)), 'employee(s)'],
      [await countWhere(tx, departments, eq(departments.workScheduleId, id)), 'department(s)'],
    ]);
    await tx.delete(workSchedules).where(eq(workSchedules.id, id));
    return { id, deleted: true };
  }

  /* ---------------- Departments (B7) ---------------- */

  @Get('departments')
  async departments() {
    const tx = this.db.tx;
    const rows = await tx
      .select({
        id: departments.id,
        name: departments.name,
        code: departments.code,
        headEmployeeId: departments.headEmployeeId,
        headName: employees.fullName,
        foodAllowanceEnabled: departments.foodAllowanceEnabled,
        paidOvertimeEnabled: departments.paidOvertimeEnabled,
        workScheduleId: departments.workScheduleId,
        isActive: departments.isActive,
      })
      .from(departments)
      .leftJoin(employees, eq(employees.id, departments.headEmployeeId))
      .orderBy(asc(departments.name));
    const counts = await tx
      .select({ departmentId: employees.departmentId, n: sql<number>`count(*)::int` })
      .from(employees)
      .where(eq(employees.employmentStatus, 'ACTIVE'))
      .groupBy(employees.departmentId);
    return rows.map((r) => ({ ...r, activeEmployees: counts.find((c) => c.departmentId === r.id)?.n ?? 0 }));
  }

  @Post('departments')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('department.created', 'department')
  async createDepartment(@Body(zp(departmentSchema)) body: DepartmentInput) {
    const tx = this.db.tx;
    const tenantId = currentUser().tenantId;
    const dept = one(await tx.insert(departments).values({ ...body, tenantId }).returning());
    // Start every new department with the default L0–L6 ladder (HR can rename).
    const template = ['Intern', 'Associate', 'Executive', 'Senior Executive', 'Team Lead', 'Manager', 'Head of Department'];
    const salaries = [25000, 50000, 80000, 120000, 160000, 220000, 300000];
    await tx.insert(levels).values(
      template.map((title, i) => ({ tenantId, departmentId: dept.id, code: `L${i}`, rank: i, title, defaultSalary: salaries[i]! })),
    );
    return dept;
  }

  @Put('departments/:id')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('department.updated', 'department')
  async updateDepartment(@Param('id', ParseUUIDPipe) id: string, @Body(zp(departmentSchema)) body: DepartmentInput) {
    return one(await this.db.tx.update(departments).set(body).where(eq(departments.id, id)).returning(), 'Department');
  }

  /** Only a department nobody has ever belonged to can be deleted (its unused levels go with it). */
  @Delete('departments/:id')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('department.deleted', 'department')
  async removeDepartment(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: departments.id }).from(departments).where(eq(departments.id, id)), 'Department');
    assertUnused('This department', [
      [await countWhere(tx, employees, eq(employees.departmentId, id)), 'employee(s)'],
      [await countWhere(tx, employeePositions, eq(employeePositions.departmentId, id)), 'past position(s)'],
      [await countWhere(tx, teams, eq(teams.departmentId, id)), 'team(s)'],
    ]);
    await tx.delete(foodAllowanceRules).where(eq(foodAllowanceRules.departmentId, id));
    await tx.delete(levels).where(eq(levels.departmentId, id));
    await deleteSafely(tx, 'This department', () => tx.delete(departments).where(eq(departments.id, id)));
    return { id, deleted: true };
  }

  /* ---------------- Levels & salary bands (B7) ---------------- */

  @Get('levels')
  levels(@Query('departmentId') departmentId?: string) {
    const q = this.db.tx.select().from(levels);
    const parsed = departmentId ? z.uuid().safeParse(departmentId) : null;
    if (parsed && !parsed.success) throw badRequest('Invalid departmentId');
    return (parsed ? q.where(eq(levels.departmentId, parsed.data)) : q).orderBy(asc(levels.departmentId), asc(levels.rank));
  }

  @Post('levels')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('level.created', 'level')
  async createLevel(@Body(zp(levelSchema)) body: z.infer<typeof levelSchema>) {
    const tx = this.db.tx;
    const [{ max }] = (await tx
      .select({ max: sql<number>`coalesce(max(${levels.rank}), -1)::int` })
      .from(levels)
      .where(eq(levels.departmentId, body.departmentId))) as [{ max: number }];
    return one(await tx.insert(levels).values({ ...body, tenantId: currentUser().tenantId, rank: max + 1 }).returning());
  }

  /** Changing the default salary affects new assignments only (B7). */
  @Patch('levels/:id')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('level.updated', 'level')
  async updateLevel(@Param('id', ParseUUIDPipe) id: string, @Body(zp(levelUpdate)) body: z.infer<typeof levelUpdate>) {
    const tx = this.db.tx;
    const cur = one(await tx.select().from(levels).where(eq(levels.id, id)), 'Level');
    const min = body.minSalary === undefined ? cur.minSalary : body.minSalary;
    const max = body.maxSalary === undefined ? cur.maxSalary : body.maxSalary;
    if (min != null && max != null && min > max) throw badRequest('Minimum salary must not exceed maximum');
    return one(await tx.update(levels).set(body).where(eq(levels.id, id)).returning());
  }

  @Post('levels/reorder')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('level.reordered', 'level')
  async reorder(@Body(zp(reorderLevelsSchema)) body: z.infer<typeof reorderLevelsSchema>) {
    const tx = this.db.tx;
    const rows = await tx.select().from(levels).where(inArray(levels.id, body.levelIds));
    if (rows.length !== body.levelIds.length || new Set(rows.map((r) => r.departmentId)).size !== 1) {
      throw badRequest('Levels must all belong to one department');
    }
    // Two passes avoid transient rank collisions.
    for (const [i, id] of body.levelIds.entries()) await tx.update(levels).set({ rank: 1000 + i }).where(eq(levels.id, id));
    for (const [i, id] of body.levelIds.entries()) await tx.update(levels).set({ rank: i }).where(eq(levels.id, id));
    return { ok: true };
  }

  @Delete('levels/:id')
  @RequireAny(P.DEPARTMENTS_MANAGE)
  @Audit('level.deleted', 'level')
  async removeLevel(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: levels.id }).from(levels).where(eq(levels.id, id)), 'Level');
    assertUnused('This level', [
      [await countWhere(tx, employees, eq(employees.levelId, id)), 'employee(s)'],
      [await countWhere(tx, employeePositions, eq(employeePositions.levelId, id)), 'past position(s)'],
    ]);
    await tx.delete(levels).where(eq(levels.id, id));
    return { id, deleted: true };
  }

  /* ---------------- Teams (A1) ---------------- */

  @Get('teams')
  async teams() {
    const tx = this.db.tx;
    const rows = await tx
      .select({
        id: teams.id,
        name: teams.name,
        departmentId: teams.departmentId,
        departmentName: departments.name,
        leadEmployeeId: teams.leadEmployeeId,
        leadName: employees.fullName,
        isActive: teams.isActive,
      })
      .from(teams)
      .innerJoin(departments, eq(departments.id, teams.departmentId))
      .innerJoin(employees, eq(employees.id, teams.leadEmployeeId))
      .orderBy(asc(teams.name));
    const counts = await tx.select({ teamId: teamMembers.teamId, n: sql<number>`count(*)::int` }).from(teamMembers).groupBy(teamMembers.teamId);
    return rows.map((r) => ({ ...r, memberCount: counts.find((c) => c.teamId === r.id)?.n ?? 0 }));
  }

  @Post('teams')
  @RequireAny(P.TEAMS_MANAGE)
  @Audit('team.created', 'team')
  async createTeam(@Body(zp(teamSchema)) body: z.infer<typeof teamSchema>) {
    const tx = this.db.tx;
    const lead = one(await tx.select().from(employees).where(eq(employees.id, body.leadEmployeeId)), 'Team lead');
    const team = one(await tx.insert(teams).values({ ...body, tenantId: currentUser().tenantId }).returning());
    // Make sure the lead holds the Team Lead role.
    if (lead.userId) {
      await tx.insert(userRoles).values({ tenantId: team.tenantId, userId: lead.userId, role: 'TEAM_LEAD' }).onConflictDoNothing();
    }
    return team;
  }

  @Put('teams/:id')
  @RequireAny(P.TEAMS_MANAGE)
  @Audit('team.updated', 'team')
  async updateTeam(@Param('id', ParseUUIDPipe) id: string, @Body(zp(teamSchema.extend({ isActive: z.boolean().default(true) }))) body: z.infer<typeof teamSchema> & { isActive: boolean }) {
    const tx = this.db.tx;
    const team = one(await tx.update(teams).set(body).where(eq(teams.id, id)).returning(), 'Team');
    const [lead] = await tx.select().from(employees).where(eq(employees.id, body.leadEmployeeId));
    if (lead?.userId) await tx.insert(userRoles).values({ tenantId: team.tenantId, userId: lead.userId, role: 'TEAM_LEAD' }).onConflictDoNothing();
    return team;
  }

  private assertTeamAccess(teamId: string) {
    const user = currentUser();
    if (user.permissions.has(P.TEAMS_MANAGE)) return;
    if (user.permissions.has(P.TEAMS_MANAGE_OWN) && user.ledTeamIds.includes(teamId)) return;
    throw forbidden('You can only manage your own team');
  }

  @Delete('teams/:id')
  @RequireAny(P.TEAMS_MANAGE)
  @Audit('team.deleted', 'team')
  async removeTeam(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, id)), 'Team');
    // Members simply become unassigned; transfer history is kept, so teams with transfers can only be deactivated.
    assertUnused('This team', [[await countWhere(tx, teamTransferRequests, or(eq(teamTransferRequests.fromTeamId, id), eq(teamTransferRequests.toTeamId, id))), 'transfer request(s)']]);
    await tx.delete(teams).where(eq(teams.id, id));
    return { id, deleted: true };
  }

  @Get('teams/:id/members')
  async members(@Param('id', ParseUUIDPipe) id: string) {
    const user = currentUser();
    if (!user.permissions.has(P.EMPLOYEES_READ_ALL) && !user.ledTeamIds.includes(id)) throw forbidden();
    return this.db.tx
      .select({
        employeeId: employees.id,
        fullName: employees.fullName,
        employeeCode: employees.employeeCode,
        designation: employees.designation,
        avatarFileId: employees.avatarFileId,
        email: employees.email,
        addedAt: teamMembers.addedAt,
      })
      .from(teamMembers)
      .innerJoin(employees, eq(employees.id, teamMembers.employeeId))
      .where(eq(teamMembers.teamId, id))
      .orderBy(asc(employees.fullName));
  }

  /**
   * A1 rule: if the person already belongs to another team, the Team Lead must submit a
   * transfer request; the member is added once it's approved.
   */
  @Post('teams/:id/members')
  @RequireAny(P.TEAMS_MANAGE, P.TEAMS_MANAGE_OWN)
  @Audit('team.member_added', 'team')
  async addMember(@Param('id', ParseUUIDPipe) id: string, @Body(zp(addTeamMemberSchema)) body: z.infer<typeof addTeamMemberSchema>) {
    this.assertTeamAccess(id);
    const tx = this.db.tx;
    const user = currentUser();
    const team = one(await tx.select().from(teams).where(eq(teams.id, id)), 'Team');
    if (body.employeeId === team.leadEmployeeId) throw badRequest('The team lead cannot be a member of their own team');
    const emp = one(await tx.select().from(employees).where(eq(employees.id, body.employeeId)), 'Employee');
    if (emp.employmentStatus !== 'ACTIVE') throw badRequest('Only active employees can join a team');
    const [existing] = await tx
      .select({ teamId: teamMembers.teamId, teamName: teams.name, leadName: employees.fullName })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .innerJoin(employees, eq(employees.id, teams.leadEmployeeId))
      .where(eq(teamMembers.employeeId, body.employeeId));

    if (existing?.teamId === id) throw badRequest('Already a member of this team');
    if (!existing) {
      await tx.insert(teamMembers).values({ tenantId: user.tenantId, teamId: id, employeeId: body.employeeId });
      await this.notify.notifyEmployees([body.employeeId], { type: 'team.added', title: `You were added to team ${team.name}` });
      return { added: true, transferRequested: false };
    }
    const [pending] = await tx
      .select({ id: teamTransferRequests.id })
      .from(teamTransferRequests)
      .where(and(eq(teamTransferRequests.employeeId, body.employeeId), eq(teamTransferRequests.status, 'PENDING')));
    if (pending) throw badRequest('A transfer request for this person is already pending');
    const req = one(
      await tx
        .insert(teamTransferRequests)
        .values({
          tenantId: user.tenantId,
          employeeId: body.employeeId,
          fromTeamId: existing.teamId,
          toTeamId: id,
          requestedByEmployeeId: user.employeeId ?? team.leadEmployeeId,
          reason: body.reason,
        })
        .returning(),
    );
    const wf = await this.approvals.submit('TEAM_TRANSFER', req.id, body.employeeId, { title: `Team transfer for ${emp.fullName}`, link: '/teams/transfers' });
    await tx.update(teamTransferRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(teamTransferRequests.id, req.id));
    if (wf.status === 'APPROVED') await this.applyTransfer(req.id);
    return { added: wf.status === 'APPROVED', transferRequested: true, currentTeam: existing.teamName, currentLead: existing.leadName, requestId: req.id };
  }

  @Delete('teams/:id/members/:employeeId')
  @RequireAny(P.TEAMS_MANAGE, P.TEAMS_MANAGE_OWN)
  @Audit('team.member_removed', 'team')
  async removeMember(@Param('id', ParseUUIDPipe) id: string, @Param('employeeId', ParseUUIDPipe) employeeId: string) {
    this.assertTeamAccess(id);
    await this.db.tx.delete(teamMembers).where(and(eq(teamMembers.teamId, id), eq(teamMembers.employeeId, employeeId)));
    return { removed: true };
  }

  private async applyTransfer(requestId: string) {
    const tx = this.db.tx;
    const r = one(await tx.select().from(teamTransferRequests).where(eq(teamTransferRequests.id, requestId)));
    await tx.delete(teamMembers).where(eq(teamMembers.employeeId, r.employeeId));
    await tx.insert(teamMembers).values({ tenantId: r.tenantId, teamId: r.toTeamId, employeeId: r.employeeId });
  }

  @Get('team-transfers')
  @RequireAny(P.TEAM_TRANSFER_APPROVE, P.TEAMS_MANAGE_OWN)
  async transfers() {
    const user = currentUser();
    const tx = this.db.tx;
    const fromTeam = sql`(select name from teams where id = ${teamTransferRequests.fromTeamId})`;
    const toTeam = sql`(select name from teams where id = ${teamTransferRequests.toTeamId})`;
    const q = tx
      .select({
        id: teamTransferRequests.id,
        employeeId: teamTransferRequests.employeeId,
        employeeName: employees.fullName,
        fromTeam: sql<string | null>`${fromTeam}`,
        toTeam: sql<string>`${toTeam}`,
        toTeamId: teamTransferRequests.toTeamId,
        reason: teamTransferRequests.reason,
        status: teamTransferRequests.status,
        currentStep: teamTransferRequests.currentStep,
        createdAt: teamTransferRequests.createdAt,
      })
      .from(teamTransferRequests)
      .innerJoin(employees, eq(employees.id, teamTransferRequests.employeeId));
    const rows = user.permissions.has(P.TEAM_TRANSFER_APPROVE)
      ? await q.orderBy(desc(teamTransferRequests.createdAt))
      : await q.where(inIds(teamTransferRequests.toTeamId, user.ledTeamIds)).orderBy(desc(teamTransferRequests.createdAt));
    return rows;
  }

  @Post('team-transfers/:id/decision')
  @RequireAny(P.TEAM_TRANSFER_APPROVE)
  @Audit('team_transfer.decided', 'team_transfer')
  async decideTransfer(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const tx = this.db.tx;
    const r = one(await tx.select().from(teamTransferRequests).where(eq(teamTransferRequests.id, id)), 'Transfer request');
    const wf = await this.approvals.decide('TEAM_TRANSFER', r, body.approve, body.comment, { title: 'Team transfer', link: '/teams/transfers' });
    await tx.update(teamTransferRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(teamTransferRequests.id, id));
    if (wf.status === 'APPROVED') {
      await this.applyTransfer(id);
      const [lead] = await tx.select({ userId: employees.userId }).from(employees).where(eq(employees.id, r.requestedByEmployeeId));
      await this.notify.notifyUsers([lead?.userId], { type: 'team.transfer_approved', title: 'Your team transfer request was approved', link: '/teams' });
    }
    return { id, status: wf.status };
  }
}
