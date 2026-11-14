import { ForbiddenException, Injectable } from '@nestjs/common';
import { PERMISSIONS as P, type PunchType } from '@hrms/shared';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { als } from '../../common/context';
import { notFound } from '../../common/errors';
import { addDays, eachDay, localDate, todayIn, zonedInstant } from '../../common/tz';
import { DbService } from '../../db/db.service';
import {
  attendanceDays,
  attendanceDevices,
  attendancePunches,
  compensationRequests,
  departments,
  employees,
  heldPunches,
  holidays,
  leaveRequests,
  leaveTypes,
  overtimeRecords,
  tenants,
  workSchedules,
} from '../../db/schema';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { computeDay, scheduledNetMinutes, type Schedule } from './attendance.logic';
import type { DevicePunch } from './biometric';

const FALLBACK_SCHEDULE: Schedule = { startTime: '09:00', endTime: '18:00', breakMinutes: 60, workingDays: [1, 2, 3, 4, 5] };

@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: DbService,
    private readonly scope: ScopeService,
    private readonly notify: NotificationsService,
  ) {}

  private tenantId(): string {
    const t = als.getStore()?.tenantId;
    if (!t) throw new Error('No tenant context');
    return t;
  }

  async tenant() {
    const [t] = await this.db.tx.select().from(tenants).where(eq(tenants.id, this.tenantId()));
    return t!;
  }

  async scheduleFor(employeeId: string): Promise<Schedule> {
    const tx = this.db.tx;
    // Employee schedule → department shift hours (CAL-02) → company default.
    const [row] = await tx
      .select({ own: employees.workScheduleId, dept: departments.workScheduleId })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(eq(employees.id, employeeId));
    const sid = row?.own ?? row?.dept;
    if (sid) {
      const [s] = await tx.select().from(workSchedules).where(eq(workSchedules.id, sid));
      if (s) return s;
    }
    const [def] = await tx.select().from(workSchedules).where(eq(workSchedules.isDefault, true)).limit(1);
    return def ?? FALLBACK_SCHEDULE;
  }

  async dailyScheduledMinutes(employeeId: string) {
    return scheduledNetMinutes(await this.scheduleFor(employeeId));
  }

  /** Recompute attendance_days for an employee over a date range (only up to today). */
  async recompute(employeeId: string, from: string, to: string) {
    const tx = this.db.tx;
    const t = await this.tenant();
    const today = todayIn(t.timezone);
    const end = to > today ? today : to;
    if (from > end) return;
    const [emp] = await tx.select().from(employees).where(eq(employees.id, employeeId));
    if (!emp) return;
    const schedule = await this.scheduleFor(employeeId);

    const startInstant = zonedInstant(addDays(from, -1), '00:00', t.timezone);
    const endInstant = zonedInstant(addDays(end, 2), '00:00', t.timezone);
    const punches = await tx
      .select()
      .from(attendancePunches)
      .where(and(eq(attendancePunches.employeeId, employeeId), gte(attendancePunches.punchedAt, startInstant), lte(attendancePunches.punchedAt, endInstant)))
      .orderBy(asc(attendancePunches.punchedAt));
    const hols = await tx
      .select()
      .from(holidays)
      .where(and(gte(holidays.date, from), lte(holidays.date, end), or(isNull(holidays.departmentId), eq(holidays.departmentId, emp.departmentId))));
    const leaves = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveRequests.status, 'APPROVED'), lte(leaveRequests.startDate, end), gte(leaveRequests.endDate, from)));
    const approvedComp = await tx
      .select({ date: compensationRequests.date, type: compensationRequests.type, minutes: compensationRequests.minutes })
      .from(compensationRequests)
      .where(and(eq(compensationRequests.employeeId, employeeId), inArray(compensationRequests.type, ['HALF_DAY', 'REDUCED_HOURS']), eq(compensationRequests.status, 'APPROVED')));
    const halfDays = approvedComp.filter((c) => c.type === 'HALF_DAY');
    const reducedOn = (date: string) => approvedComp.filter((c) => c.type === 'REDUCED_HOURS' && c.date === date).reduce((a, c) => a + c.minutes, 0);

    for (const date of eachDay(from, end)) {
      if (date < emp.joiningDate || (emp.exitDate && date > emp.exitDate)) continue;
      const dayPunches = punches.filter((p) => localDate(p.punchedAt, t.timezone) === date);
      const leave = leaves.find((l) => l.startDate <= date && l.endDate >= date);
      const r = computeDay({
        date,
        tz: t.timezone,
        schedule,
        punches: dayPunches.map((p) => ({ at: p.punchedAt, type: p.type as PunchType | null, source: p.source })),
        isHoliday: hols.some((h) => h.date === date),
        leave: leave ? (leave.halfDay ? 'HALF' : 'FULL') : 'NONE',
        compensationHalfDay: halfDays.some((h) => h.date === date),
        reducedMinutes: reducedOn(date),
        overtimeThresholdMinutes: t.settings.overtimeThresholdMinutes,
        isFuture: date >= today,
      });
      const status = r.status === 'PENDING' ? 'ABSENT' : r.status;
      if (r.status === 'PENDING') {
        // Nothing to store yet for today.
        await tx.delete(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, date)));
        continue;
      }
      const values = {
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        breakMinutes: r.breakMinutes,
        workedMinutes: r.workedMinutes,
        scheduledMinutes: r.scheduledMinutes,
        lateMinutes: r.lateMinutes,
        overtimeMinutes: r.overtimeMinutes,
        status,
        skippedBreak: r.skippedBreak,
        earlyLeave: r.earlyLeave,
      };
      await tx
        .insert(attendanceDays)
        .values({ tenantId: t.id, employeeId, date, ...values })
        .onConflictDoUpdate({ target: [attendanceDays.employeeId, attendanceDays.date], set: values });

      // C2: completed days with overtime get an overtime record awaiting Team Lead approval.
      if (date < today) await this.syncOvertime(employeeId, date, r.overtimeMinutes);
    }
  }

  private async syncOvertime(employeeId: string, date: string, minutes: number) {
    const tx = this.db.tx;
    const [existing] = await tx.select().from(overtimeRecords).where(and(eq(overtimeRecords.employeeId, employeeId), eq(overtimeRecords.date, date)));
    if (existing) {
      if (existing.status === 'PENDING') {
        if (minutes === 0) await tx.delete(overtimeRecords).where(eq(overtimeRecords.id, existing.id));
        else if (existing.minutes !== minutes) await tx.update(overtimeRecords).set({ minutes }).where(eq(overtimeRecords.id, existing.id));
      }
      return;
    }
    if (minutes <= 0) return;
    await tx.insert(overtimeRecords).values({ tenantId: this.tenantId(), employeeId, date, minutes, status: 'PENDING', currentStep: 'TEAM_LEAD' });
    const lead = await this.scope.teamLeadOf(employeeId);
    const [emp] = await tx.select({ name: employees.fullName }).from(employees).where(eq(employees.id, employeeId));
    const n = { type: 'approval.overtime', title: 'Overtime awaiting your approval', body: `${emp?.name}: ${Math.round(minutes / 6) / 10}h on ${date}`, link: '/attendance/overtime' };
    if (lead?.userId && lead.employeeId !== employeeId) await this.notify.notifyUsers([lead.userId], n);
    else await this.notify.notifyPermission(P.OVERTIME_APPROVE_TL, n);
  }

  /** Store punches (deduplicated) and recompute affected days. Returns counts. */
  async ingest(
    punches: { employeeId: string; at: Date; type?: PunchType | null; note?: string }[],
    source: 'DEVICE' | 'IMPORT' | 'MANUAL' | 'CORRECTION',
    deviceId?: string,
  ) {
    if (!punches.length) return { inserted: 0 };
    const tx = this.db.tx;
    const t = await this.tenant();
    // Tenant isolation: only employees of this company (the select is filtered by RLS). Foreign keys alone
    // don't stop a punch here from pointing at another company's employee id.
    const ids = [...new Set(punches.map((p) => p.employeeId))];
    const own = await tx.select({ id: employees.id }).from(employees).where(inArray(employees.id, ids));
    if (own.length !== ids.length) throw notFound('Employee');
    const inserted = await tx
      .insert(attendancePunches)
      .values(punches.map((p) => ({ tenantId: t.id, employeeId: p.employeeId, punchedAt: p.at, type: p.type ?? null, source, deviceId, note: p.note })))
      .onConflictDoNothing()
      .returning({ id: attendancePunches.id });
    const affected = new Map<string, Set<string>>();
    for (const p of punches) {
      const d = localDate(p.at, t.timezone);
      if (!affected.has(p.employeeId)) affected.set(p.employeeId, new Set());
      affected.get(p.employeeId)!.add(d);
    }
    for (const [emp, dates] of affected) {
      const sorted = [...dates].sort();
      await this.recompute(emp, sorted[0]!, sorted[sorted.length - 1]!);
    }
    return { inserted: inserted.length };
  }

  async employeeIdsByCode(codes: string[]) {
    const rows = await this.db.tx
      .select({ id: employees.id, code: employees.employeeCode })
      .from(employees)
      .where(inArray(employees.employeeCode, [...new Set(codes)]));
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  /** BIO-04: device user ID → employee, using the HR mapping first and the employee code as a fallback. */
  async resolveDeviceUsers(deviceUserIds: string[]) {
    const ids = [...new Set(deviceUserIds)];
    if (!ids.length) return new Map<string, string>();
    const rows = await this.db.tx
      .select({ id: employees.id, code: employees.employeeCode, bio: employees.biometricUserId })
      .from(employees)
      .where(or(inArray(employees.biometricUserId, ids), inArray(employees.employeeCode, ids)));
    const map = new Map<string, string>();
    for (const r of rows) if (r.code && ids.includes(r.code) && !map.has(r.code)) map.set(r.code, r.id);
    for (const r of rows) if (r.bio) map.set(r.bio, r.id); // explicit mapping wins
    return map;
  }

  /**
   * Stores punches received from a device. Known users go straight to attendance; unknown device user IDs
   * are held for HR (BIO-04). Re-sent punches after an outage are ignored by unique keys (BIO-03).
   */
  async ingestDevicePunches(deviceId: string, punches: DevicePunch[]) {
    const tx = this.db.tx;
    const t = await this.tenant();
    if (!t.modules.includes('BIOMETRIC')) {
      throw new ForbiddenException({ message: "Biometric devices are not included in this company's plan", code: 'MODULE_DISABLED' });
    }
    const map = await this.resolveDeviceUsers(punches.map((p) => p.deviceUserId));
    const known = punches.filter((p) => map.has(p.deviceUserId));
    const unknown = punches.filter((p) => !map.has(p.deviceUserId));
    const res = await this.ingest(known.map((p) => ({ employeeId: map.get(p.deviceUserId)!, at: p.at, type: p.type })), 'DEVICE', deviceId);
    let held = 0;
    if (unknown.length) {
      const rows = await tx
        .insert(heldPunches)
        .values(unknown.map((p) => ({ tenantId: this.tenantId(), deviceId, deviceUserId: p.deviceUserId, punchedAt: p.at, type: p.type })))
        .onConflictDoNothing()
        .returning({ id: heldPunches.id });
      held = rows.length;
      if (held) await this.notify.notifyPermission(P.ATTENDANCE_MANAGE, { type: 'attendance.unknown_device_user', title: 'Punches from an unknown device user', body: `Device user ID ${[...new Set(unknown.map((u) => u.deviceUserId))].join(', ')} isn't linked to an employee`, link: '/attendance?tab=admin' });
    }
    const now = new Date();
    await tx.update(attendanceDevices).set({ lastSeenAt: now, ...(punches.length ? { lastSyncAt: now } : {}) }).where(eq(attendanceDevices.id, deviceId));
    return { received: punches.length, inserted: res.inserted, held, unknownDeviceUserIds: [...new Set(unknown.map((u) => u.deviceUserId))] };
  }

  /** Minutes of approved overtime still available for compensation (C2). */
  async overtimeBalance(employeeId: string) {
    const tx = this.db.tx;
    const [earned] = await tx
      .select({ m: sql<number>`coalesce(sum(coalesce(${overtimeRecords.approvedMinutes}, ${overtimeRecords.minutes})), 0)::int` })
      .from(overtimeRecords)
      .where(and(eq(overtimeRecords.employeeId, employeeId), eq(overtimeRecords.status, 'APPROVED')));
    const [usedComp] = await tx
      .select({ m: sql<number>`coalesce(sum(${compensationRequests.minutes}), 0)::int` })
      .from(compensationRequests)
      .where(and(eq(compensationRequests.employeeId, employeeId), inArray(compensationRequests.status, ['PENDING', 'APPROVED'])));
    const [usedLeave] = await tx
      .select({ d: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::float` })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(eq(leaveRequests.employeeId, employeeId), eq(leaveTypes.derivedFromOvertime, true), inArray(leaveRequests.status, ['PENDING', 'APPROVED'])));
    const dayMinutes = await this.dailyScheduledMinutes(employeeId);
    const earnedM = earned?.m ?? 0;
    const used = (usedComp?.m ?? 0) + Math.round((usedLeave?.d ?? 0) * dayMinutes);
    return { earnedMinutes: earnedM, usedMinutes: used, availableMinutes: Math.max(0, earnedM - used), dayMinutes };
  }
}
