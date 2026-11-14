import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS as P,
  canAssignRole,
  companyEmailDomains,
  joinedLabel,
  tenureLabel,
  type EmployeeInput,
  type EmployeeUpdateInput,
  type PromotionInput,
  type SelfProfileUpdateInput,
} from '@hrms/shared';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { currentUser, type AuthUser } from '../../common/context';
import { badRequest, conflict, forbidden } from '../../common/errors';
import { addDays, todayIn } from '../../common/tz';
import { emailInUse, inIds, like, offset, one, page, requireDelete, tenantInfo } from '../../common/util';
import { recordPurger } from '../../db/purge';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { hashPassword } from '../../common/crypto';
import { DbService } from '../../db/db.service';
import {
  departments,
  employeePositions,
  employees,
  levels,
  refreshTokens,
  teamMembers,
  teams,
  tenants,
  userRoles,
  users,
} from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { nextEmployeeCode } from '../auth/provisioning';

const manager = alias(employees, 'manager');

/** Fields hidden from anyone other than the employee and org-wide HR/Ops (F4). */
const CONFIDENTIAL = ['basicSalary', 'cnic', 'fatherCnic'] as const;

@Injectable()
export class EmployeesService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly auth: AuthService,
    private readonly notify: NotificationsService,
  ) {}

  private baseSelect() {
    return this.db.tx
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        userId: employees.userId,
        fullName: employees.fullName,
        email: employees.email,
        cnic: employees.cnic,
        fatherName: employees.fatherName,
        fatherCnic: employees.fatherCnic,
        bloodGroup: employees.bloodGroup,
        emergencyContact: employees.emergencyContact,
        contactNo: employees.contactNo,
        dateOfBirth: employees.dateOfBirth,
        avatarFileId: employees.avatarFileId,
        departmentId: employees.departmentId,
        departmentName: departments.name,
        levelId: employees.levelId,
        levelCode: levels.code,
        levelTitle: levels.title,
        designation: employees.designation,
        reportingManagerId: employees.reportingManagerId,
        reportingManagerName: manager.fullName,
        hierarchyTier: employees.hierarchyTier,
        joiningDate: employees.joiningDate,
        exitDate: employees.exitDate,
        employmentStatus: employees.employmentStatus,
        basicSalary: employees.basicSalary,
        workScheduleId: employees.workScheduleId,
        onboardingCompletedAt: employees.onboardingCompletedAt,
        medicalEligible: employees.medicalEligible,
        createdAt: employees.createdAt,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .innerJoin(levels, eq(levels.id, employees.levelId))
      .leftJoin(manager, eq(manager.id, employees.reportingManagerId));
  }

  private redact<T extends Record<string, unknown>>(row: T, user: AuthUser): T {
    if (user.employeeId === row.id || user.permissions.has(P.EMPLOYEES_READ_ALL)) return row;
    const copy = { ...row };
    for (const k of CONFIDENTIAL) if (k in copy) (copy as Record<string, unknown>)[k] = null;
    return copy;
  }

  async list(q: { page: number; pageSize: number; search?: string; departmentId?: string; status?: string }) {
    const user = currentUser();
    const visible = await this.scope.visibleEmployeeIds(P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM);
    const conds: SQL[] = [];
    if (visible) conds.push(inIds(employees.id, visible));
    if (q.search) conds.push(or(ilike(employees.fullName, like(q.search)), ilike(employees.email, like(q.search)), ilike(employees.employeeCode, like(q.search)))!);
    if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
    if (q.status) conds.push(eq(employees.employmentStatus, q.status as 'ACTIVE'));
    const where = conds.length ? and(...conds) : undefined;
    const rows = await this.baseSelect().where(where).orderBy(sql`${employees.employmentStatus} <> 'ACTIVE'`, asc(employees.fullName)).limit(q.pageSize).offset(offset(q));
    const [{ n }] = (await this.db.tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(where)) as [{ n: number }];
    return page(rows.map((r) => this.redact(r, user)), n, q);
  }

  async get(id: string) {
    await this.scope.assertCanView(id, P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM);
    const row = one(await this.baseSelect().where(eq(employees.id, id)), 'Employee');
    const [team] = await this.db.tx
      .select({ teamId: teams.id, teamName: teams.name, leadEmployeeId: teams.leadEmployeeId })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.employeeId, id));
    const roles = row.userId
      ? (await this.db.tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, row.userId))).map((r) => r.role)
      : [];
    const [account] = row.userId ? await this.db.tx.select({ status: users.status }).from(users).where(eq(users.id, row.userId)) : [];
    const [{ n: promotions }] = (await this.db.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(employeePositions)
      .where(and(eq(employeePositions.employeeId, id), eq(employeePositions.changeType, 'PROMOTED')))) as [{ n: number }];
    return { ...this.redact(row, currentUser()), team: team ?? null, roles, accountStatus: account?.status ?? null, hasPromotions: promotions > 0, tenure: tenureLabel(row.joiningDate) };
  }

  private async validatePlacement(departmentId: string, levelId: string) {
    const tx = this.db.tx;
    const dept = one(await tx.select().from(departments).where(eq(departments.id, departmentId)), 'Department');
    if (!dept.isActive) throw badRequest('Department is inactive');
    const level = one(await tx.select().from(levels).where(eq(levels.id, levelId)), 'Level');
    if (level.departmentId !== departmentId) throw badRequest('Level does not belong to the selected department');
    if (!level.isActive) throw badRequest('Level is inactive');
    return { dept, level };
  }

  /** HR adds an employee: profile + login account (invite email) + first position record. */
  async create(input: EmployeeInput) {
    const tx = this.db.tx;
    const actor = currentUser();
    for (const r of input.roles) if (!canAssignRole(actor.roles, r)) throw forbidden(`You cannot grant the ${r} role`);
    const { level } = await this.validatePlacement(input.departmentId, input.levelId);
    await this.assertCompanyEmail(input.email);
    if (await emailInUse(this.db, input.email)) throw conflict('This email is already used by another account. Every account needs its own email.', 'EMAIL_TAKEN');
    await this.assertSeatAvailable();

    const salary = input.basicSalary ?? level.defaultSalary; // B7 auto-fill, HR may override
    const emp = one(
      await tx
        .insert(employees)
        .values({
          tenantId: actor.tenantId,
          employeeCode: await nextEmployeeCode(tx, actor.tenantId),
          fullName: input.fullName,
          email: input.email,
          cnic: input.cnic,
          fatherName: input.fatherName,
          fatherCnic: input.fatherCnic,
          bloodGroup: input.bloodGroup,
          emergencyContact: input.emergencyContact,
          contactNo: input.contactNo,
          dateOfBirth: input.dateOfBirth,
          departmentId: input.departmentId,
          levelId: input.levelId,
          designation: input.designation,
          reportingManagerId: input.reportingManagerId ?? null,
          hierarchyTier: input.hierarchyTier,
          joiningDate: input.joiningDate,
          basicSalary: salary,
          workScheduleId: input.workScheduleId ?? null,
          medicalEligible: input.medicalEligible ?? false,
        })
        .returning(),
    );
    await tx.insert(employeePositions).values({
      tenantId: actor.tenantId,
      employeeId: emp.id,
      departmentId: emp.departmentId,
      levelId: emp.levelId,
      designation: emp.designation,
      salary,
      startDate: emp.joiningDate,
      changeType: 'JOINED',
      recordedByUserId: actor.userId,
    });
    // HR either emails an invitation or sets the first password (the person can be asked to change it).
    const user = one(
      await tx
        .insert(users)
        .values({
          tenantId: actor.tenantId,
          email: input.email,
          employeeId: emp.id,
          status: input.password ? 'ACTIVE' : 'INVITED',
          passwordHash: input.password ? await hashPassword(input.password) : null,
          passwordChangedAt: input.password ? new Date() : null,
          mustChangePassword: !!input.password && input.mustChangePassword,
        })
        .returning(),
    );
    const roles = [...new Set([...input.roles, 'EMPLOYEE'])];
    await tx.insert(userRoles).values(roles.map((role) => ({ tenantId: actor.tenantId, userId: user.id, role })));
    await tx.update(employees).set({ userId: user.id }).where(eq(employees.id, emp.id));
    if (input.sendInvite && !input.password) await this.auth.sendTokenEmail(tx, actor.tenantId, user, 'INVITE', actor.userId);
    return { ...emp, userId: user.id };
  }

  /** New or changed login emails must use one of the company's email domains (when one is set). */
  private async assertCompanyEmail(email: string) {
    const [t] = await this.db.tx.select({ emailDomain: tenants.emailDomain, extraEmailDomains: tenants.extraEmailDomains }).from(tenants).where(eq(tenants.id, currentUser().tenantId));
    const domains = t ? companyEmailDomains(t) : [];
    const at = email.toLowerCase().split('@').pop();
    if (domains.length && !domains.includes(at ?? '')) {
      throw badRequest(`Company emails must end with ${domains.map((d) => `@${d}`).join(' or ')}`, 'EMAIL_DOMAIN');
    }
  }

  async update(id: string, input: EmployeeUpdateInput) {
    const tx = this.db.tx;
    const cur = one(await tx.select().from(employees).where(eq(employees.id, id)), 'Employee');
    if (input.departmentId || input.levelId) await this.validatePlacement(input.departmentId ?? cur.departmentId, input.levelId ?? cur.levelId);
    if (input.reportingManagerId === id) throw badRequest('An employee cannot report to themselves');
    if (input.email && input.email !== cur.email) await this.assertCompanyEmail(input.email);
    if (input.email && input.email !== cur.email && (await emailInUse(this.db, input.email, cur.userId ?? undefined))) {
      throw conflict('This email is already used by another account. Every account needs its own email.', 'EMAIL_TAKEN');
    }
    if (input.email && input.email !== cur.email && cur.userId) {
      await tx.update(users).set({ email: input.email }).where(eq(users.id, cur.userId));
    }
    const { roles: _r, sendInvite: _s, password: _p, mustChangePassword: _m, ...rest } = input as EmployeeUpdateInput & { roles?: unknown; sendInvite?: unknown; password?: unknown; mustChangePassword?: unknown };
    if (input.employmentStatus === 'ACTIVE' && cur.employmentStatus !== 'ACTIVE') await this.assertSeatAvailable();
    const updated = one(await tx.update(employees).set(rest).where(eq(employees.id, id)).returning());
    // Level/department/salary changes through edit are recorded as an adjustment in the position history.
    if (input.levelId && input.levelId !== cur.levelId) {
      await this.closeAndOpenPosition(updated, 'ADJUSTED', todayIn((await tenantInfo(tx)).timezone));
    }
    if (input.employmentStatus && input.employmentStatus !== 'ACTIVE' && cur.userId) {
      await this.disableUser(cur.userId);
    }
    // Status set back to Active in the edit form: same as Reactivate (login restored).
    if (input.employmentStatus === 'ACTIVE' && cur.employmentStatus !== 'ACTIVE') {
      await tx.update(employees).set({ exitDate: null }).where(eq(employees.id, id));
      if (cur.userId) await this.restoreLogin(cur.userId);
    }
    return updated;
  }

  /** Subscription limit on active employees. */
  private async assertSeatAvailable() {
    const tx = this.db.tx;
    const [plan] = await tx.select({ max: tenants.maxEmployees }).from(tenants).where(eq(tenants.id, currentUser().tenantId));
    if (!plan?.max) return;
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(eq(employees.employmentStatus, 'ACTIVE'))) as [{ n: number }];
    if (n >= plan.max) throw conflict(`Your plan allows ${plan.max} active employees. Contact your provider to raise the limit.`, 'PLAN_LIMIT');
  }

  /** Former employee comes back: ACTIVE again, exit date cleared, login restored if asked (and they had one). */
  async reactivate(id: string, restoreLogin: boolean) {
    const tx = this.db.tx;
    const cur = one(await tx.select().from(employees).where(eq(employees.id, id)), 'Employee');
    if (cur.employmentStatus === 'ACTIVE') throw badRequest('This employee is already active');
    await this.assertSeatAvailable();
    const emp = one(await tx.update(employees).set({ employmentStatus: 'ACTIVE', exitDate: null }).where(eq(employees.id, id)).returning());
    let login: 'restored' | 'invite_needed' | 'kept_disabled' | 'none' = 'none';
    if (cur.userId) {
      if (restoreLogin) login = (await this.restoreLogin(cur.userId)) ? 'restored' : 'invite_needed';
      else login = 'kept_disabled';
    }
    return { ...emp, login };
  }

  /**
   * Permanently deletes a former employee and everything that belongs to them (attendance, leave, payslips, documents…).
   * Only for people who have already left; links from other people's records (e.g. "approved by") are cleared.
   */
  async remove(id: string) {
    requireDelete();
    const tx = this.db.tx;
    const actor = currentUser();
    const cur = one(await tx.select().from(employees).where(eq(employees.id, id)), 'Employee');
    if (cur.employmentStatus === 'ACTIVE') throw badRequest('Terminate this employee first. Only former employees can be deleted.', 'STILL_ACTIVE');
    if (actor.employeeId === id) throw badRequest('You cannot delete yourself');
    if (cur.userId) {
      const roles = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, cur.userId));
      if (roles.some((r) => r.role === 'SUPER_ADMIN')) throw badRequest('Remove the Company Admin role from this person before deleting them.', 'IS_ADMIN');
      await recordPurger.purge(tx, 'users', [cur.userId]);
    }
    await recordPurger.purge(tx, 'employees', [id]);
    return { id, fullName: cur.fullName, deleted: true };
  }

  /**
   * Gives a returning employee their login back: active if they have a password, otherwise still invited
   * (they set one from their invitation). Returns whether they can sign in right away.
   */
  private async restoreLogin(userId: string): Promise<boolean> {
    const tx = this.db.tx;
    const [u] = await tx.select({ hash: users.passwordHash }).from(users).where(eq(users.id, userId));
    await tx.update(users).set({ status: u?.hash ? 'ACTIVE' : 'INVITED' }).where(eq(users.id, userId));
    return !!u?.hash;
  }

  async disableUser(userId: string) {
    const tx = this.db.tx;
    await tx.update(users).set({ status: 'DISABLED', tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async updateSelf(input: SelfProfileUpdateInput) {
    const employeeId = this.scope.requireEmployee();
    if (input.dateOfBirth) {
      // Employees may fill in their date of birth once; after that only HR changes it.
      const [cur] = await this.db.tx.select({ dob: employees.dateOfBirth }).from(employees).where(eq(employees.id, employeeId));
      if (cur?.dob && cur.dob !== input.dateOfBirth) throw forbidden('Your date of birth is already on record. Ask HR to change it.');
      if (input.dateOfBirth > todayIn((await tenantInfo(this.db.tx)).timezone)) throw badRequest('Date of birth cannot be in the future');
    }
    return one(await this.db.tx.update(employees).set(input).where(eq(employees.id, employeeId)).returning());
  }

  /* ---------------- B8 promotions ---------------- */

  private async closeAndOpenPosition(
    emp: typeof employees.$inferSelect,
    changeType: 'PROMOTED' | 'TRANSFERRED' | 'ADJUSTED',
    effectiveDate: string,
    notes?: string,
  ) {
    const tx = this.db.tx;
    const [open] = await tx
      .select()
      .from(employeePositions)
      .where(and(eq(employeePositions.employeeId, emp.id), isNull(employeePositions.endDate)))
      .orderBy(desc(employeePositions.startDate))
      .limit(1);
    if (open && effectiveDate < open.startDate) throw badRequest('Effective date is before the current position started');
    if (open) await tx.update(employeePositions).set({ endDate: effectiveDate }).where(eq(employeePositions.id, open.id));
    await tx.insert(employeePositions).values({
      tenantId: emp.tenantId,
      employeeId: emp.id,
      departmentId: emp.departmentId,
      levelId: emp.levelId,
      designation: emp.designation,
      salary: emp.basicSalary,
      startDate: effectiveDate,
      changeType,
      notes,
      recordedByUserId: currentUser().userId,
    });
  }

  async promote(id: string, input: PromotionInput) {
    const tx = this.db.tx;
    const cur = one(await tx.select().from(employees).where(eq(employees.id, id)), 'Employee');
    const departmentId = input.departmentId ?? cur.departmentId;
    const { level } = await this.validatePlacement(departmentId, input.levelId);
    const [curLevel] = await tx.select().from(levels).where(eq(levels.id, cur.levelId));
    if (input.levelId === cur.levelId && departmentId === cur.departmentId) throw badRequest('Choose a different level');
    const changeType = departmentId === cur.departmentId && level.rank > (curLevel?.rank ?? -1) ? 'PROMOTED' : departmentId !== cur.departmentId ? 'TRANSFERRED' : 'ADJUSTED';
    const updated = one(
      await tx
        .update(employees)
        .set({
          departmentId,
          levelId: input.levelId,
          designation: input.designation ?? level.title,
          basicSalary: input.salary ?? level.defaultSalary, // B8: new level default, editable by HR
        })
        .where(eq(employees.id, id))
        .returning(),
    );
    await this.closeAndOpenPosition(updated, changeType, input.effectiveDate, input.notes);
    await this.notify.notifyEmployees([id], {
      type: 'employee.promoted',
      title: changeType === 'PROMOTED' ? `Congratulations! You've been promoted to ${level.code} – ${updated.designation}` : `Your position was updated to ${level.code} – ${updated.designation}`,
      link: '/profile',
    });
    return updated;
  }

  async positions(id: string) {
    const user = currentUser();
    if (user.employeeId !== id && !user.permissions.has(P.EMPLOYEES_READ_ALL)) {
      await this.scope.assertCanView(id, P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM);
    }
    const rows = await this.db.tx
      .select({
        id: employeePositions.id,
        designation: employeePositions.designation,
        levelCode: levels.code,
        levelTitle: levels.title,
        departmentName: departments.name,
        salary: employeePositions.salary,
        startDate: employeePositions.startDate,
        endDate: employeePositions.endDate,
        changeType: employeePositions.changeType,
        notes: employeePositions.notes,
        createdAt: employeePositions.createdAt,
      })
      .from(employeePositions)
      .innerJoin(levels, eq(levels.id, employeePositions.levelId))
      .innerJoin(departments, eq(departments.id, employeePositions.departmentId))
      .where(eq(employeePositions.employeeId, id))
      .orderBy(asc(employeePositions.startDate), asc(employeePositions.createdAt));
    const showSalary = user.employeeId === id || user.permissions.has(P.EMPLOYEES_READ_ALL);
    return rows.map((r) => ({ ...r, salary: showSalary ? r.salary : null }));
  }

  async recentPromotions() {
    return this.db.tx
      .select({
        id: employeePositions.id,
        employeeId: employees.id,
        fullName: employees.fullName,
        avatarFileId: employees.avatarFileId,
        designation: employeePositions.designation,
        levelCode: levels.code,
        levelTitle: levels.title,
        departmentName: departments.name,
        changeType: employeePositions.changeType,
        startDate: employeePositions.startDate,
        notes: employeePositions.notes,
      })
      .from(employeePositions)
      .innerJoin(employees, eq(employees.id, employeePositions.employeeId))
      .innerJoin(levels, eq(levels.id, employeePositions.levelId))
      .innerJoin(departments, eq(departments.id, employeePositions.departmentId))
      .where(inArray(employeePositions.changeType, ['PROMOTED', 'TRANSFERRED', 'ADJUSTED']))
      .orderBy(desc(employeePositions.startDate), desc(employeePositions.createdAt))
      .limit(200);
  }

  /* ---------------- B5 directory ---------------- */

  async directory(q: { search?: string; departmentId?: string }) {
    const tx = this.db.tx;
    const t = await tenantInfo(tx);
    const conds: SQL[] = [eq(employees.employmentStatus, 'ACTIVE')];
    if (q.search) conds.push(or(ilike(employees.fullName, like(q.search)), ilike(employees.designation, like(q.search)), ilike(departments.name, like(q.search)), ilike(employees.email, like(q.search)), ilike(employees.employeeCode, like(q.search)))!);
    if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
    const rows = await tx
      .select({
        id: employees.id,
        employeeCode: employees.employeeCode,
        fullName: employees.fullName,
        avatarFileId: employees.avatarFileId,
        email: employees.email,
        contactNo: employees.contactNo,
        departmentId: employees.departmentId,
        departmentName: departments.name,
        designation: employees.designation,
        reportingManagerId: employees.reportingManagerId,
        reportingManagerName: manager.fullName,
        levelCode: levels.code,
        levelTitle: levels.title,
        hierarchyTier: employees.hierarchyTier,
        joiningDate: employees.joiningDate,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .innerJoin(levels, eq(levels.id, employees.levelId))
      .leftJoin(manager, eq(manager.id, employees.reportingManagerId))
      .where(and(...conds))
      .orderBy(asc(employees.fullName))
      .limit(500);
    const today = todayIn(t.timezone);
    return rows.map(({ joiningDate, ...r }) => ({
      ...r,
      level: `${r.levelCode} – ${r.levelTitle}`,
      tenure: tenureLabel(joiningDate, today),
      // Joining date in the directory only when the company allows it (B5); the same wording as on profiles.
      since: t.settings.directoryShowJoinDate ? joinedLabel(joiningDate) : null,
    }));
  }

  /** Organisational hierarchy, top to bottom (B5). */
  async orgChart() {
    const rows = await this.db.tx
      .select({
        id: employees.id,
        fullName: employees.fullName,
        designation: employees.designation,
        avatarFileId: employees.avatarFileId,
        departmentName: departments.name,
        hierarchyTier: employees.hierarchyTier,
        reportingManagerId: employees.reportingManagerId,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.employmentStatus, 'ACTIVE'));
    return rows;
  }

  /* ---------------- B6 headcount ---------------- */

  async headcount() {
    const tx = this.db.tx;
    const t = await tenantInfo(tx);
    const since30 = addDays(todayIn(t.timezone), -30);
    const byStatus = await tx.select({ status: employees.employmentStatus, n: sql<number>`count(*)::int` }).from(employees).groupBy(employees.employmentStatus);
    const byDepartment = await tx
      .select({ departmentId: departments.id, name: departments.name, n: sql<number>`count(${employees.id})::int` })
      .from(departments)
      .leftJoin(employees, and(eq(employees.departmentId, departments.id), eq(employees.employmentStatus, 'ACTIVE')))
      .groupBy(departments.id, departments.name)
      .orderBy(asc(departments.name));
    const byTeam = await tx
      .select({ teamId: teams.id, name: teams.name, n: sql<number>`count(${teamMembers.employeeId})::int` })
      .from(teams)
      .leftJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .groupBy(teams.id, teams.name)
      .orderBy(asc(teams.name));
    const monthly = await tx.execute(sql`
      with months as (
        select to_char(d, 'YYYY-MM') as m from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') d
      )
      select m as month,
        (select count(*)::int from employees e where to_char(e.joining_date, 'YYYY-MM') = m) as joined,
        (select count(*)::int from employees e where e.exit_date is not null and to_char(e.exit_date, 'YYYY-MM') = m) as left
      from months order by m`);
    const recentJoiners = await tx
      .select({ id: employees.id, fullName: employees.fullName, designation: employees.designation, departmentName: departments.name, date: employees.joiningDate })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .orderBy(desc(employees.joiningDate))
      .limit(10);
    const leavers = await tx
      .select({ id: employees.id, fullName: employees.fullName, designation: employees.designation, departmentName: departments.name, status: employees.employmentStatus, date: employees.exitDate })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(inArray(employees.employmentStatus, ['RESIGNED', 'TERMINATED']))
      .orderBy(desc(employees.exitDate))
      .limit(50);
    const [{ n: newRegistrations }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(employees).where(gte(employees.joiningDate, since30))) as [{ n: number }];
    const s = (k: string) => byStatus.find((b) => b.status === k)?.n ?? 0;
    return {
      total: byStatus.reduce((a, b) => a + b.n, 0),
      active: s('ACTIVE'),
      inactive: s('INACTIVE'),
      resigned: s('RESIGNED'),
      terminated: s('TERMINATED'),
      newRegistrations,
      byDepartment,
      byTeam,
      monthly: monthly.rows,
      recentJoiners,
      leavers,
    };
  }
}
