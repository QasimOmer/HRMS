import { Controller, Get, Query } from '@nestjs/common';
import { PERMISSIONS as P } from '@hrms/shared';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser, type AuthUser } from '../../common/context';
import { RequireModule } from '../../common/decorators';
import { forbidden } from '../../common/errors';
import { csvFile, round2, tenantInfo } from '../../common/util';
import { todayIn } from '../../common/tz';
import { zp } from '../../common/zod.pipe';
import type { Tx } from '../../db/db.service';
import { DbService } from '../../db/db.service';
import { departments, employees, kpiTargets } from '../../db/schema';

/** KPI metrics that count as sales revenue. */
const REVENUE_METRIC = or(ilike(kpiTargets.metric, '%revenue%'), ilike(kpiTargets.metric, '%sales%'))!;

/** A department is the sales department by its code (SALES) or name. */
export const isSalesDept = (code: string | null | undefined, name: string | null | undefined) => code?.toUpperCase() === 'SALES' || /\bsales\b/i.test(name ?? '');

/**
 * Who may see sales revenue, sales reports, dashboard sales metrics and exports:
 *  - anyone whose role holds "View sales revenue" (Company Admin always; other roles only if granted), or
 *  - active employees currently in the Sales department.
 * Read fresh from the database on every request, so a department or role change applies immediately.
 */
export async function salesAccess(tx: Tx, user: AuthUser = currentUser()): Promise<{ allowed: boolean; via: 'permission' | 'department' | null }> {
  if (!user.modules.includes('PERFORMANCE')) return { allowed: false, via: null };
  if (user.permissions.has(P.SALES_REVENUE_READ)) return { allowed: true, via: 'permission' };
  if (!user.employeeId) return { allowed: false, via: null };
  const [row] = await tx
    .select({ code: departments.code, name: departments.name, status: employees.employmentStatus })
    .from(employees)
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(eq(employees.id, user.employeeId));
  if (row && row.status === 'ACTIVE' && isSalesDept(row.code, row.name)) return { allowed: true, via: 'department' };
  return { allowed: false, via: null };
}

/** Sales revenue figures for a month: totals, per person and a 6-month trend. */
export async function salesSummary(tx: Tx, period: string) {
  const achievedSql = (status: string) =>
    sql<number>`coalesce((select sum(s.achieved_value) from kpi_submissions s where s.target_id = ${kpiTargets.id} and s.status = ${status}), 0)::float`;
  const rows = await tx
    .select({
      employeeId: employees.id,
      employeeCode: employees.employeeCode,
      fullName: employees.fullName,
      departmentName: departments.name,
      target: sql<number>`coalesce(sum(${kpiTargets.targetValue}), 0)::float`,
      achieved: sql<number>`coalesce(sum(${achievedSql('APPROVED')}), 0)::float`,
      pending: sql<number>`coalesce(sum(${achievedSql('PENDING')}), 0)::float`,
    })
    .from(kpiTargets)
    .innerJoin(employees, eq(employees.id, kpiTargets.employeeId))
    .innerJoin(departments, eq(departments.id, employees.departmentId))
    .where(and(eq(kpiTargets.period, period), REVENUE_METRIC))
    .groupBy(employees.id, employees.employeeCode, employees.fullName, departments.name);
  const byEmployee = rows
    .map((r) => ({ ...r, progress: r.target > 0 ? round2((r.achieved / r.target) * 100) : null }))
    .sort((a, b) => b.achieved - a.achieved || a.fullName.localeCompare(b.fullName));
  const trend = (
    await tx.execute(sql`
      with months as (select to_char(m, 'YYYY-MM') as period from generate_series(to_date(${period}, 'YYYY-MM') - interval '5 months', to_date(${period}, 'YYYY-MM'), interval '1 month') m)
      select months.period,
        coalesce((select sum(t.target_value) from kpi_targets t where t.period = months.period and (t.metric ilike '%revenue%' or t.metric ilike '%sales%')), 0)::float as target,
        coalesce((select sum(s.achieved_value) from kpi_submissions s join kpi_targets t on t.id = s.target_id
          where t.period = months.period and s.status = 'APPROVED' and (t.metric ilike '%revenue%' or t.metric ilike '%sales%')), 0)::float as achieved
      from months order by months.period`)
  ).rows as { period: string; target: number; achieved: number }[];
  const [inc] = (
    await tx.execute(sql`
      select coalesce(sum(i.amount), 0)::float as total from incentives i join kpi_submissions s on s.id = i.kpi_submission_id
      join kpi_targets t on t.id = s.target_id
      where i.period = ${period} and i.status <> 'VOID' and (t.metric ilike '%revenue%' or t.metric ilike '%sales%')`)
  ).rows as [{ total: number }];
  const sum = (k: 'target' | 'achieved' | 'pending') => round2(byEmployee.reduce((a, r) => a + r[k], 0));
  const target = sum('target');
  const achieved = sum('achieved');
  return {
    period,
    totals: { target, achieved, pending: sum('pending'), progress: target > 0 ? round2((achieved / target) * 100) : null, incentives: round2(inc.total), people: byEmployee.length },
    byEmployee,
    trend,
  };
}

const periodQuery = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM').optional() });

/** Sales revenue overview and export. Every endpoint checks access on the server. */
@RequireModule('PERFORMANCE')
@Controller('sales')
export class SalesController {
  constructor(private readonly db: DbService) {}

  private async assertAccess() {
    const a = await salesAccess(this.db.tx);
    if (!a.allowed) throw forbidden('Sales revenue is only available to the Sales department and people given "View sales revenue".');
  }

  private async period(q: { period?: string }) {
    return q.period ?? todayIn((await tenantInfo(this.db.tx)).timezone).slice(0, 7);
  }

  @Get('access')
  access() {
    return salesAccess(this.db.tx);
  }

  @Get('overview')
  async overview(@Query(zp(periodQuery)) q: z.infer<typeof periodQuery>) {
    await this.assertAccess();
    const t = await tenantInfo(this.db.tx);
    return { currency: t.currency, ...(await salesSummary(this.db.tx, await this.period(q))) };
  }

  @Get('export')
  async export(@Query(zp(periodQuery)) q: z.infer<typeof periodQuery>) {
    await this.assertAccess();
    const s = await salesSummary(this.db.tx, await this.period(q));
    return csvFile(
      [
        ['Period', 'Employee ID', 'Name', 'Department', 'Target', 'Achieved (approved)', 'Pending', 'Progress %'],
        ...s.byEmployee.map((r) => [s.period, r.employeeCode, r.fullName, r.departmentName, r.target, r.achieved, r.pending, r.progress ?? '']),
      ],
      `sales-revenue-${s.period}.csv`,
    );
  }
}

