import { Injectable } from '@nestjs/common';
import type { LeaveRequestInput } from '@hrms/shared';
import { and, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { currentUser } from '../../common/context';
import { badRequest } from '../../common/errors';
import { dayOfWeek, eachDay, todayIn } from '../../common/tz';
import { one, round2 } from '../../common/util';
import { DbService } from '../../db/db.service';
import { employees, holidays, leaveAllocations, leaveRequests, leaveTypes } from '../../db/schema';
import { AttendanceService } from '../attendance/attendance.service';

@Injectable()
export class LeaveService {
  constructor(
    private readonly db: DbService,
    private readonly attendance: AttendanceService,
  ) {}

  /** Working days in range, excluding weekends (per schedule) and holidays. */
  async countDays(employeeId: string, start: string, end: string, halfDay: boolean): Promise<number> {
    const tx = this.db.tx;
    const schedule = await this.attendance.scheduleFor(employeeId);
    const [emp] = await tx.select({ dept: employees.departmentId }).from(employees).where(eq(employees.id, employeeId));
    const hols = await tx
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, start), lte(holidays.date, end), or(isNull(holidays.departmentId), eq(holidays.departmentId, emp!.dept))));
    const set = new Set(hols.map((h) => h.date));
    const n = eachDay(start, end).filter((d) => schedule.workingDays.includes(dayOfWeek(d)) && !set.has(d)).length;
    return halfDay ? (n ? 0.5 : 0) : n;
  }

  async balances(employeeId: string, year: number) {
    const tx = this.db.tx;
    const types = await tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true)).orderBy(leaveTypes.code);
    const [emp] = await tx.select({ joiningDate: employees.joiningDate }).from(employees).where(eq(employees.id, employeeId));
    const joinYear = emp ? Number(emp.joiningDate.slice(0, 4)) : year;
    // Load every year up to `year` once so carry-forward (LEV-09) can be chained.
    const allocs = await tx
      .select({ typeId: leaveAllocations.leaveTypeId, year: leaveAllocations.year, days: sql<number>`sum(${leaveAllocations.days})::float` })
      .from(leaveAllocations)
      .where(and(eq(leaveAllocations.employeeId, employeeId), lte(leaveAllocations.year, year)))
      .groupBy(leaveAllocations.leaveTypeId, leaveAllocations.year);
    const usage = await tx
      .select({
        typeId: leaveRequests.leaveTypeId,
        year: sql<number>`extract(year from ${leaveRequests.startDate})::int`,
        status: leaveRequests.status,
        days: sql<number>`sum(${leaveRequests.days})::float`,
      })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.employeeId, employeeId), sql`extract(year from ${leaveRequests.startDate}) <= ${year}`, inArray(leaveRequests.status, ['PENDING', 'APPROVED'])))
      .groupBy(leaveRequests.leaveTypeId, sql`extract(year from ${leaveRequests.startDate})`, leaveRequests.status);
    const ot = await this.attendance.overtimeBalance(employeeId);

    const usedIn = (typeId: string, y: number, status: 'APPROVED' | 'PENDING') => usage.find((u) => u.typeId === typeId && u.year === y && u.status === status)?.days ?? 0;
    const adjIn = (typeId: string, y: number) => allocs.find((a) => a.typeId === typeId && a.year === y)?.days ?? 0;

    return types.map((t) => {
      const used = usedIn(t.id, year, 'APPROVED');
      const pending = usedIn(t.id, year, 'PENDING');
      if (t.derivedFromOvertime) {
        // Compensation leave comes from approved overtime (C3); pending/used is already netted out.
        const available = ot.dayMinutes ? Math.floor((ot.availableMinutes / ot.dayMinutes) * 2) / 2 : 0;
        return { leaveTypeId: t.id, code: t.code, name: t.name, color: t.color, isPaid: t.isPaid, derivedFromOvertime: true, allocated: round2(available + used + pending), carriedForward: 0, used, pending, available };
      }
      // LEV-09: unused days roll into the next year when HR enables it, up to HR's limit.
      let carried = 0;
      for (let y = joinYear; y < year; y++) {
        const left = t.annualAllowance + adjIn(t.id, y) + carried - usedIn(t.id, y, 'APPROVED') - usedIn(t.id, y, 'PENDING');
        carried = t.carryForward ? Math.max(0, Math.min(left, t.carryForwardMax ?? Infinity)) : 0;
      }
      carried = round2(carried);
      const allocated = round2(t.annualAllowance + adjIn(t.id, year) + carried);
      return { leaveTypeId: t.id, code: t.code, name: t.name, color: t.color, isPaid: t.isPaid, derivedFromOvertime: false, allocated, carriedForward: carried, used, pending, available: round2(allocated - used - pending) };
    });
  }

  async validateRequest(employeeId: string, input: LeaveRequestInput) {
    const tx = this.db.tx;
    const type = one(await tx.select().from(leaveTypes).where(eq(leaveTypes.id, input.leaveTypeId)), 'Leave type');
    if (!type.isActive) throw badRequest('This leave type is not available');
    if (input.startDate.slice(0, 4) !== input.endDate.slice(0, 4)) throw badRequest('Split leave that crosses into a new year into two requests');
    const days = await this.countDays(employeeId, input.startDate, input.endDate, input.halfDay);
    if (days <= 0) throw badRequest('The selected dates contain no working days');
    const [overlap] = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, employeeId),
          inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
          lte(leaveRequests.startDate, input.endDate),
          gte(leaveRequests.endDate, input.startDate),
        ),
      )
      .limit(1);
    if (overlap) throw badRequest('You already have leave during these dates', 'OVERLAP');
    const bal = (await this.balances(employeeId, Number(input.startDate.slice(0, 4)))).find((b) => b.leaveTypeId === type.id);
    if (type.isPaid && bal && days > bal.available) {
      throw badRequest(`Not enough ${type.name.toLowerCase()} balance (available: ${bal.available} day${bal.available === 1 ? '' : 's'})`, 'INSUFFICIENT_BALANCE');
    }
    return { type, days };
  }

  /** Approved/cancelled leave changes attendance automatically (C3). */
  async syncAttendance(employeeId: string, start: string, end: string) {
    const t = await this.attendance.tenant();
    const today = todayIn(t.timezone);
    if (start <= today) await this.attendance.recompute(employeeId, start, end < today ? end : today);
  }

  tenantId() {
    return currentUser().tenantId;
  }
}
