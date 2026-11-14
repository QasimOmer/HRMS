import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { currentUser } from '../../common/context';
import { badRequest } from '../../common/errors';
import { dayOfWeek, eachDay, monthRange, todayIn } from '../../common/tz';
import { one, round2, tenantInfo } from '../../common/util';
import { DbService } from '../../db/db.service';
import {
  attendanceDays,
  compensationRequests,
  departments,
  employees,
  foodAllowanceRules,
  holidays,
  incentives,
  levels,
  loanRepayments,
  loans,
  medicalClaims,
  payrollRuns,
  payslips,
  salaryComponents,
  type PayslipLine,
} from '../../db/schema';
import { AttendanceService } from '../attendance/attendance.service';
import { scheduledNetMinutes } from '../attendance/attendance.logic';
import { calcPayslip } from './payroll.logic';

@Injectable()
export class PayrollService {
  constructor(
    private readonly db: DbService,
    private readonly attendance: AttendanceService,
  ) {}

  async loanOutstanding(loanId: string): Promise<number> {
    const tx = this.db.tx;
    const loan = one(await tx.select().from(loans).where(eq(loans.id, loanId)), 'Loan');
    const [paid] = await tx.select({ s: sql<number>`coalesce(sum(${loanRepayments.amount}), 0)::float` }).from(loanRepayments).where(eq(loanRepayments.loanId, loanId));
    return round2(loan.principal - (paid?.s ?? 0));
  }

  /** (Re)calculate every payslip in a run. Manual adjustments are preserved. */
  async calculate(runId: string) {
    const tx = this.db.tx;
    const run = one(await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)), 'Payroll run');
    if (!['DRAFT', 'REJECTED'].includes(run.status)) throw badRequest('Only draft or rejected runs can be recalculated');
    const t = await tenantInfo(tx);
    const { from, to } = monthRange(run.period);
    const today = todayIn(t.timezone);

    const emps = await tx
      .select({ e: employees, departmentName: departments.name, levelCode: levels.code, levelTitle: levels.title, foodEnabled: departments.foodAllowanceEnabled })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .innerJoin(levels, eq(levels.id, employees.levelId))
      .where(and(lte(employees.joiningDate, to), or(isNull(employees.exitDate), gte(employees.exitDate, from))));

    const existing = await tx.select().from(payslips).where(eq(payslips.payrollRunId, runId));
    const comps = await tx.select().from(salaryComponents).where(eq(salaryComponents.isActive, true));
    const rules = await tx.select().from(foodAllowanceRules).where(eq(foodAllowanceRules.isActive, true));
    const hols = await tx.select().from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to)));

    let totalGross = 0;
    let totalNet = 0;
    for (const { e, departmentName, levelCode, levelTitle, foodEnabled } of emps) {
      const schedule = await this.attendance.scheduleFor(e.id);
      const dayNet = scheduledNetMinutes(schedule);
      const holidaySet = new Set(hols.filter((h) => !h.departmentId || h.departmentId === e.departmentId).map((h) => h.date));
      const workingDays = eachDay(from, to).filter((d) => schedule.workingDays.includes(dayOfWeek(d)) && !holidaySet.has(d));
      const employedDays = workingDays.filter((d) => d >= e.joiningDate && (!e.exitDate || d <= e.exitDate));

      const days = await tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, e.id), gte(attendanceDays.date, from), lte(attendanceDays.date, to)));
      const byDate = new Map(days.map((d) => [d.date, d]));
      // Paid leave & approved half-day compensation reduce "scheduled" on the day – credit that back.
      const unpaidLeaveDates = new Set(
        (
          await tx.execute(sql`
            select d::date::text as date from leave_requests lr
            join leave_types lt on lt.id = lr.leave_type_id
            cross join generate_series(lr.start_date, lr.end_date, interval '1 day') d
            where lr.employee_id = ${e.id} and lr.status = 'APPROVED' and lt.is_paid = false
              and d::date between ${from}::date and ${to}::date`)
        ).rows.map((r) => (r as { date: string }).date),
      );
      let payable = 0;
      for (const d of employedDays) {
        const rec = byDate.get(d);
        if (!rec) {
          payable += d > today ? dayNet : 0; // future days projected as worked; missing past days unpaid
          continue;
        }
        const credited = unpaidLeaveDates.has(d) ? 0 : Math.max(0, dayNet - rec.scheduledMinutes);
        payable += Math.min(rec.workedMinutes, rec.scheduledMinutes) + credited;
      }

      const myComps = comps.filter((c) => (!c.employeeId && !c.departmentId) || c.employeeId === e.id || (!c.employeeId && c.departmentId === e.departmentId));
      const rule = foodEnabled ? rules.find((r) => r.departmentId === e.departmentId) : undefined;
      const paidOt = await tx
        .select({ m: sql<number>`coalesce(sum(${compensationRequests.minutes}), 0)::int` })
        .from(compensationRequests)
        .where(and(eq(compensationRequests.employeeId, e.id), eq(compensationRequests.type, 'PAID'), eq(compensationRequests.status, 'APPROVED'), or(isNull(compensationRequests.payrollRunId), eq(compensationRequests.payrollRunId, runId))));
      const incs = await tx
        .select()
        .from(incentives)
        .where(and(eq(incentives.employeeId, e.id), lte(incentives.period, run.period), or(and(eq(incentives.status, 'APPROVED'), isNull(incentives.payrollRunId)), eq(incentives.payrollRunId, runId))));
      const meds = await tx
        .select()
        .from(medicalClaims)
        .where(and(eq(medicalClaims.employeeId, e.id), eq(medicalClaims.status, 'APPROVED'), or(isNull(medicalClaims.payrollRunId), eq(medicalClaims.payrollRunId, runId))));
      const activeLoans = await tx.select().from(loans).where(and(eq(loans.employeeId, e.id), eq(loans.status, 'ACTIVE'), lte(loans.startPeriod, run.period)));
      const loanInputs = [];
      for (const l of activeLoans) loanInputs.push({ id: l.id, installment: l.installment, outstanding: await this.loanOutstanding(l.id) });

      const prev = existing.find((p) => p.employeeId === e.id);
      const manual = (prev?.lines ?? []).filter((l) => l.manual);
      const r = calcPayslip({
        basicSalary: e.basicSalary,
        fullMonthMinutes: workingDays.length * dayNet,
        employedMinutes: employedDays.length * dayNet,
        payableMinutes: payable,
        workingHoursBased: t.settings.payrollWorkingHoursBased,
        components: myComps,
        food: rule ? { rule, days } : null,
        paidOvertimeMinutes: paidOt[0]?.m ?? 0,
        incentives: incs.map((i) => ({ id: i.id, amount: i.amount, label: `Incentive (${i.period})` })),
        medical: meds.map((m) => ({ id: m.id, amount: m.approvedAmount ?? m.amount })),
        loans: loanInputs,
        manual,
      });
      const snapshot = {
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        designation: e.designation,
        departmentName,
        level: `${levelCode} – ${levelTitle}`,
        joiningDate: e.joiningDate, // CNIC deliberately not copied into payslips (SEC-05)
        lateMinutes: days.reduce((a, d) => a + d.lateMinutes, 0), // ATT-03: monthly late total
        workingDays: workingDays.length,
        employedDays: employedDays.length,
        foodDays: r.foodDays,
        loanDeductions: r.loanDeductions,
        incentiveIds: incs.map((i) => i.id),
        medicalClaimIds: meds.map((m) => m.id),
        provisional: to >= today,
      };
      const values = {
        basicSalary: e.basicSalary,
        scheduledMinutes: employedDays.length * dayNet,
        payableMinutes: payable,
        earnedBasic: r.earnedBasic,
        totalAllowances: r.totalAllowances,
        totalDeductions: r.totalDeductions,
        gross: r.gross,
        net: r.net,
        lines: r.lines,
        snapshot,
      };
      await tx
        .insert(payslips)
        .values({ tenantId: t.id, payrollRunId: runId, employeeId: e.id, period: run.period, ...values })
        .onConflictDoUpdate({ target: [payslips.payrollRunId, payslips.employeeId], set: values });
      totalGross += r.gross;
      totalNet += r.net;
    }
    // Remove slips for people no longer in scope.
    const ids = emps.map((x) => x.e.id);
    for (const p of existing) if (!ids.includes(p.employeeId)) await tx.delete(payslips).where(eq(payslips.id, p.id));

    await tx
      .update(payrollRuns)
      .set({ totalGross: round2(totalGross), totalNet: round2(totalNet), employeeCount: emps.length, processedAt: new Date(), processedByUserId: currentUser().userId })
      .where(eq(payrollRuns.id, runId));
  }

  /** Recompute totals after a manual adjustment on one slip. */
  async applyManualLines(payslipId: string, lines: PayslipLine[]) {
    const tx = this.db.tx;
    const p = one(await tx.select().from(payslips).where(eq(payslips.id, payslipId)), 'Payslip');
    const sum = (kinds: PayslipLine['kind'][]) => round2(lines.filter((l) => kinds.includes(l.kind)).reduce((a, l) => a + l.amount, 0));
    const earned = sum(['EARNING']);
    const allowances = sum(['ALLOWANCE', 'BONUS']);
    const deductions = sum(['DEDUCTION']);
    const gross = round2(earned + allowances);
    await tx.update(payslips).set({ lines, totalAllowances: allowances, totalDeductions: deductions, gross, net: round2(Math.max(0, gross - deductions)) }).where(eq(payslips.id, payslipId));
    const [tot] = await tx
      .select({ g: sql<number>`sum(${payslips.gross})::float`, n: sql<number>`sum(${payslips.net})::float` })
      .from(payslips)
      .where(eq(payslips.payrollRunId, p.payrollRunId));
    await tx.update(payrollRuns).set({ totalGross: round2(tot?.g ?? 0), totalNet: round2(tot?.n ?? 0) }).where(eq(payrollRuns.id, p.payrollRunId));
  }

  /**
   * PAY-08: undo the side effects of finalize() so a locked run can be corrected.
   * Incentives, claims and paid overtime stay linked to this run so the recalculation picks them up again.
   */
  async reopen(runId: string) {
    const tx = this.db.tx;
    const booked = await tx.select({ loanId: loanRepayments.loanId }).from(loanRepayments).where(eq(loanRepayments.payrollRunId, runId));
    await tx.delete(loanRepayments).where(eq(loanRepayments.payrollRunId, runId));
    for (const loanId of new Set(booked.map((b) => b.loanId))) {
      if ((await this.loanOutstanding(loanId)) > 0) await tx.update(loans).set({ status: 'ACTIVE' }).where(and(eq(loans.id, loanId), eq(loans.status, 'CLOSED')));
    }
    await tx.update(incentives).set({ status: 'APPROVED' }).where(and(eq(incentives.payrollRunId, runId), eq(incentives.status, 'PAID')));
  }

  /** Book side effects once a run is fully approved (loan repayments, paid incentives, claims). */
  async finalize(runId: string) {
    const tx = this.db.tx;
    const run = one(await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)));
    const slips = await tx.select().from(payslips).where(eq(payslips.payrollRunId, runId));
    const { to } = monthRange(run.period);
    for (const s of slips) {
      const snap = s.snapshot as { loanDeductions?: { loanId: string; amount: number }[]; incentiveIds?: string[]; medicalClaimIds?: string[] };
      for (const ld of snap.loanDeductions ?? []) {
        await tx.insert(loanRepayments).values({ tenantId: run.tenantId, loanId: ld.loanId, amount: ld.amount, paidOn: to, source: 'PAYROLL', payrollRunId: runId });
        if ((await this.loanOutstanding(ld.loanId)) <= 0) await tx.update(loans).set({ status: 'CLOSED' }).where(eq(loans.id, ld.loanId));
      }
      if (snap.incentiveIds?.length) await tx.update(incentives).set({ status: 'PAID', payrollRunId: runId }).where(inArray(incentives.id, snap.incentiveIds));
      if (snap.medicalClaimIds?.length) await tx.update(medicalClaims).set({ payrollRunId: runId }).where(inArray(medicalClaims.id, snap.medicalClaimIds));
      await tx
        .update(compensationRequests)
        .set({ payrollRunId: runId })
        .where(and(eq(compensationRequests.employeeId, s.employeeId), eq(compensationRequests.type, 'PAID'), eq(compensationRequests.status, 'APPROVED'), isNull(compensationRequests.payrollRunId)));
    }
  }
}
