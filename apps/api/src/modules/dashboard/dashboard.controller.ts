import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS as P, WORKFLOWS, type WorkflowType } from '@hrms/shared';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { currentUser } from '../../common/context';
import { addDays, todayIn } from '../../common/tz';
import { tenantInfo } from '../../common/util';
import { ApprovalsService } from '../../core/approvals.service';
import { ScopeService } from '../../core/scope.service';
import { DbService } from '../../db/db.service';
import {
  attendanceDays,
  auditLogs,
  calendarEvents,
  complaints,
  departments,
  employeeDocuments,
  employees,
  holidays,
  kpiSubmissions,
  kpiTargets,
  payrollRuns,
  payslips,
  policies,
  posts,
  queries,
  surveys,
  teamMembers,
  users,
} from '../../db/schema';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from '../leave/leave.service';

const TABLES: Record<Exclude<WorkflowType, 'PAYROLL'>, { table: string; label: string; link: string }> = {
  LEAVE: { table: 'leave_requests', label: 'Leave request', link: '/leave/approvals' },
  ATTENDANCE_CORRECTION: { table: 'attendance_corrections', label: 'Attendance correction', link: '/attendance/corrections' },
  OVERTIME: { table: 'overtime_records', label: 'Overtime', link: '/attendance/overtime' },
  COMPENSATION: { table: 'compensation_requests', label: 'Overtime compensation', link: '/attendance/overtime' },
  KPI: { table: 'kpi_submissions', label: 'KPI submission', link: '/kpi' },
  RESIGNATION: { table: 'resignations', label: 'Resignation', link: '/resignations' },
  TEAM_TRANSFER: { table: 'team_transfer_requests', label: 'Team transfer', link: '/teams' },
  MEDICAL_CLAIM: { table: 'medical_claims', label: 'Medical claim', link: '/medical' },
  LOAN_REQUEST: { table: 'loans', label: 'Loan request', link: '/loans' },
};

@Controller()
export class DashboardController {
  constructor(
    private readonly db: DbService,
    private readonly approvals: ApprovalsService,
    private readonly scope: ScopeService,
    private readonly attendance: AttendanceService,
    private readonly leave: LeaveService,
  ) {}

  /** Everything currently waiting on the signed-in user (H1, G4). */
  @Get('approvals/inbox')
  async inbox() {
    const u = currentUser();
    const items: { workflow: string; label: string; id: string; employeeId: string; employeeName: string; step: string; createdAt: string; link: string }[] = [];
    for (const [type, meta] of Object.entries(TABLES) as [Exclude<WorkflowType, 'PAYROLL'>, (typeof TABLES)[keyof typeof TABLES]][]) {
      const steps = WORKFLOWS[type].filter((s) => u.permissions.has(s.permission)).map((s) => s.key);
      if (!steps.length) continue;
      const res = await this.db.tx.execute(
        sql`select t.id, t.employee_id, t.current_step, t.created_at, e.full_name
            from ${sql.raw(meta.table)} t join employees e on e.id = t.employee_id
            where t.status = 'PENDING' and t.current_step in ${sql.raw(`(${steps.map((s) => `'${s}'`).join(',')})`)}
            order by t.created_at asc limit 200`,
      );
      for (const r of res.rows as { id: string; employee_id: string; current_step: string; created_at: string; full_name: string }[]) {
        const ok = await this.approvals.canDecide(type, { id: r.id, status: 'PENDING', currentStep: r.current_step, employeeId: r.employee_id });
        if (ok) items.push({ workflow: type, label: meta.label, id: r.id, employeeId: r.employee_id, employeeName: r.full_name, step: r.current_step, createdAt: r.created_at, link: meta.link });
      }
    }
    if (u.permissions.has(P.PAYROLL_APPROVE_HR) || u.permissions.has(P.PAYROLL_APPROVE_OPS)) {
      const runs = await this.db.tx.select().from(payrollRuns).where(eq(payrollRuns.status, 'PENDING_APPROVAL'));
      for (const r of runs) {
        const step = WORKFLOWS.PAYROLL.find((s) => s.key === r.currentStep);
        if (step && u.permissions.has(step.permission)) {
          items.push({ workflow: 'PAYROLL', label: `Payroll ${r.period}`, id: r.id, employeeId: '', employeeName: '', step: r.currentStep!, createdAt: r.updatedAt.toISOString(), link: `/payroll/runs/${r.id}` });
        }
      }
    }
    return items;
  }

  /** A2 – one payload with a section per capability the user has. */
  @Get('dashboard')
  async dashboard() {
    const u = currentUser();
    const tx = this.db.tx;
    const t = await tenantInfo(tx);
    const today = todayIn(t.timezone);
    const month = today.slice(0, 7);
    const out: Record<string, unknown> = { today, month, currency: t.currency };

    // ---- Employee section (everyone with a profile)
    if (u.employeeId) {
      const id = u.employeeId;
      const [emp] = await tx.select({ dept: employees.departmentId }).from(employees).where(eq(employees.id, id));
      const [att] = await tx
        .select({
          present: sql<number>`count(*) filter (where ${attendanceDays.status} in ('PRESENT','LATE','HALF_DAY'))::int`,
          late: sql<number>`count(*) filter (where ${attendanceDays.status} = 'LATE')::int`,
          absent: sql<number>`count(*) filter (where ${attendanceDays.status} = 'ABSENT')::int`,
          leave: sql<number>`count(*) filter (where ${attendanceDays.status} = 'ON_LEAVE')::int`,
          worked: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}),0)::int`,
          scheduled: sql<number>`coalesce(sum(${attendanceDays.scheduledMinutes}),0)::int`,
          overtime: sql<number>`coalesce(sum(${attendanceDays.overtimeMinutes}),0)::int`,
          foodDays: sql<number>`count(*) filter (where ${attendanceDays.workedMinutes} >= 480 and not ${attendanceDays.workFromHome} and not ${attendanceDays.earlyLeave})::int`,
        })
        .from(attendanceDays)
        .where(and(eq(attendanceDays.employeeId, id), sql`to_char(${attendanceDays.date}, 'YYYY-MM') = ${month}`));
      const [todayRec] = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, id), eq(attendanceDays.date, today)));
      const [lastSlip] = await tx
        .select({ id: payslips.id, period: payslips.period, net: payslips.net, gross: payslips.gross })
        .from(payslips)
        .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
        .where(and(eq(payslips.employeeId, id), inArray(payrollRuns.status, ['APPROVED', 'PAID'])))
        .orderBy(desc(payslips.period))
        .limit(1);
      const kpi = await tx
        .select({
          metric: kpiTargets.metric,
          unit: kpiTargets.unit,
          target: kpiTargets.targetValue,
          achieved: sql<number | null>`(select max(achieved_value)::float from kpi_submissions s where s.target_id = ${kpiTargets.id} and s.status in ('PENDING','APPROVED'))`,
        })
        .from(kpiTargets)
        .where(and(eq(kpiTargets.employeeId, id), eq(kpiTargets.period, month)));
      const upcomingHolidays = await tx
        .select()
        .from(holidays)
        .where(and(gte(holidays.date, today), lte(holidays.date, addDays(today, 60)), or(isNull(holidays.departmentId), eq(holidays.departmentId, emp!.dept))))
        .orderBy(holidays.date)
        .limit(5);
      const upcomingEvents = await tx
        .select()
        .from(calendarEvents)
        .where(and(gte(calendarEvents.endDate, today), lte(calendarEvents.startDate, addDays(today, 30)), or(eq(calendarEvents.visibility, 'COMPANY'), eq(calendarEvents.departmentId, emp!.dept))))
        .orderBy(calendarEvents.startDate)
        .limit(5);
      const [docs] = await tx.select({ n: sql<number>`count(*)::int` }).from(employeeDocuments).where(and(eq(employeeDocuments.employeeId, id), eq(employeeDocuments.source, 'HR')));
      const [openQueries] = await tx.select({ n: sql<number>`count(*)::int` }).from(queries).where(and(eq(queries.employeeId, id), inArray(queries.status, ['PENDING', 'IN_PROGRESS'])));
      out.employee = {
        attendance: att,
        today: todayRec ?? null,
        overtime: await this.attendance.overtimeBalance(id),
        leaveBalances: await this.leave.balances(id, Number(today.slice(0, 4))),
        lastPayslip: lastSlip ?? null,
        kpi,
        upcomingHolidays,
        upcomingEvents,
        hrDocuments: docs?.n ?? 0,
        openQueries: openQueries?.n ?? 0,
      };
    }

    out.announcements = await tx
      .select({ id: posts.id, title: posts.title, body: posts.body, createdAt: posts.createdAt, pinned: posts.pinned })
      .from(posts)
      .where(and(eq(posts.type, 'ANNOUNCEMENT'), isNull(posts.deletedAt)))
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(3);
    out.community = await tx
      .select({ id: posts.id, type: posts.type, title: posts.title, body: posts.body, createdAt: posts.createdAt })
      .from(posts)
      .where(and(inArray(posts.type, ['POST', 'BIRTHDAY']), isNull(posts.deletedAt), isNull(posts.departmentId)))
      .orderBy(desc(posts.createdAt))
      .limit(3);

    // ---- Team Lead section
    if (u.ledTeamIds.length) {
      const memberIds = await this.scope.teamMemberIds(u);
      const todayStats = memberIds.length
        ? await tx
            .select({ status: attendanceDays.status, n: sql<number>`count(*)::int` })
            .from(attendanceDays)
            .where(and(inArray(attendanceDays.employeeId, memberIds), eq(attendanceDays.date, today)))
            .groupBy(attendanceDays.status)
        : [];
      const performance = memberIds.length
        ? await tx
            .select({
              employeeId: employees.id,
              fullName: employees.fullName,
              target: sql<number>`coalesce(sum(${kpiTargets.targetValue}),0)::float`,
              achieved: sql<number>`coalesce((select sum(achieved_value) from kpi_submissions s where s.employee_id = ${employees.id} and s.period = ${month} and s.status in ('PENDING','APPROVED')),0)::float`,
            })
            .from(employees)
            .leftJoin(kpiTargets, and(eq(kpiTargets.employeeId, employees.id), eq(kpiTargets.period, month)))
            .where(inArray(employees.id, memberIds))
            .groupBy(employees.id, employees.fullName)
        : [];
      const [assigned] = u.employeeId
        ? await tx.select({ n: sql<number>`count(*)::int` }).from(queries).where(and(eq(queries.assignedToEmployeeId, u.employeeId), inArray(queries.status, ['PENDING', 'IN_PROGRESS'])))
        : [{ n: 0 }];
      const [teamSurveys] = await tx.select({ n: sql<number>`count(*)::int` }).from(surveys).where(and(eq(surveys.createdByUserId, u.userId), eq(surveys.status, 'OPEN')));
      out.teamLead = {
        memberCount: memberIds.length,
        todayAttendance: Object.fromEntries(todayStats.map((s) => [s.status, s.n])),
        notCheckedIn: Math.max(0, memberIds.length - todayStats.reduce((a, s) => a + s.n, 0)),
        performance,
        openQueries: assigned?.n ?? 0,
        openSurveys: teamSurveys?.n ?? 0,
      };
    }

    // ---- HR / Operations / Super Admin organisation section
    if (u.permissions.has(P.HEADCOUNT_READ) || u.permissions.has(P.ATTENDANCE_READ_ALL)) {
      const byStatus = await tx.select({ status: employees.employmentStatus, n: sql<number>`count(*)::int` }).from(employees).groupBy(employees.employmentStatus);
      const todayAll = await tx.select({ status: attendanceDays.status, n: sql<number>`count(*)::int` }).from(attendanceDays).where(eq(attendanceDays.date, today)).groupBy(attendanceDays.status);
      const byDept = await tx
        .select({ name: departments.name, n: sql<number>`count(${employees.id})::int` })
        .from(departments)
        .leftJoin(employees, and(eq(employees.departmentId, departments.id), eq(employees.employmentStatus, 'ACTIVE')))
        .groupBy(departments.name)
        .orderBy(departments.name);
      const [hours] = await tx
        .select({ worked: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}),0)::int`, scheduled: sql<number>`coalesce(sum(${attendanceDays.scheduledMinutes}),0)::int` })
        .from(attendanceDays)
        .where(sql`to_char(${attendanceDays.date}, 'YYYY-MM') = ${month}`);
      const [run] = await tx.select().from(payrollRuns).orderBy(desc(payrollRuns.period)).limit(1);
      const [openComplaints] = u.permissions.has(P.COMPLAINTS_MANAGE)
        ? await tx.select({ n: sql<number>`count(*)::int` }).from(complaints).where(inArray(complaints.status, ['SUBMITTED', 'UNDER_REVIEW']))
        : [{ n: 0 }];
      const [draftPolicies] = await tx.select({ n: sql<number>`count(*)::int` }).from(policies).where(eq(policies.status, 'DRAFT'));
      const [openQueriesAll] = await tx.select({ n: sql<number>`count(*)::int` }).from(queries).where(inArray(queries.status, ['PENDING', 'IN_PROGRESS']));
      const [pendingKpi] = await tx.select({ n: sql<number>`count(*)::int` }).from(kpiSubmissions).where(eq(kpiSubmissions.status, 'PENDING'));
      const [unteamed] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(employees)
        .leftJoin(teamMembers, eq(teamMembers.employeeId, employees.id))
        .where(and(eq(employees.employmentStatus, 'ACTIVE'), isNull(teamMembers.teamId)));
      const s = (k: string) => byStatus.find((b) => b.status === k)?.n ?? 0;
      // 6-month trends for the charts: headcount at month end, joiners and leavers; payroll cost per run.
      const workforceTrend = (
        await tx.execute(sql`
          select to_char(m, 'YYYY-MM') as month,
            (select count(*) from employees e where e.joining_date <= (m + interval '1 month' - interval '1 day')::date
               and (e.exit_date is null or e.exit_date > (m + interval '1 month' - interval '1 day')::date))::int as headcount,
            (select count(*) from employees e where date_trunc('month', e.joining_date) = m)::int as joined,
            (select count(*) from employees e where e.exit_date is not null and date_trunc('month', e.exit_date) = m)::int as "left"
          from generate_series(date_trunc('month', ${today}::date) - interval '5 months', date_trunc('month', ${today}::date), interval '1 month') m
          order by m`)
      ).rows as { month: string; headcount: number; joined: number; left: number }[];
      const payrollTrend = u.permissions.has(P.PAYROLL_READ_ALL)
        ? (await tx.select({ period: payrollRuns.period, totalNet: payrollRuns.totalNet, status: payrollRuns.status }).from(payrollRuns).orderBy(desc(payrollRuns.period)).limit(6)).reverse()
        : [];
      out.organisation = {
        workforceTrend,
        payrollTrend,
        headcount: { total: byStatus.reduce((a, b) => a + b.n, 0), active: s('ACTIVE'), inactive: s('INACTIVE'), resigned: s('RESIGNED'), terminated: s('TERMINATED') },
        todayAttendance: Object.fromEntries(todayAll.map((x) => [x.status, x.n])),
        byDepartment: byDept,
        hoursThisMonth: hours,
        latestPayroll: run ?? null,
        openComplaints: openComplaints?.n ?? 0,
        draftPolicies: draftPolicies?.n ?? 0,
        openQueries: openQueriesAll?.n ?? 0,
        pendingKpi: pendingKpi?.n ?? 0,
        employeesWithoutTeam: unteamed?.n ?? 0,
      };
    }

    // ---- Super Admin system overview
    if (u.roles.includes('SUPER_ADMIN')) {
      const [userStats] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${users.status} = 'ACTIVE')::int`,
          invited: sql<number>`count(*) filter (where ${users.status} = 'INVITED')::int`,
          disabled: sql<number>`count(*) filter (where ${users.status} = 'DISABLED')::int`,
        })
        .from(users);
      const [deptCount] = await tx.select({ n: sql<number>`count(*)::int` }).from(departments).where(eq(departments.isActive, true));
      const recentAudit = (await tx.select({ a: auditLogs, email: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).orderBy(desc(auditLogs.id)).limit(8))
        .map((r) => ({ ...r.a, actorLabel: r.a.actorLabel ?? r.email ?? null }));
      out.system = { users: userStats, departments: deptCount?.n ?? 0, recentAudit };
    }

    out.pendingApprovals = (await this.inbox()).length;
    return out;
  }
}
