import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ATTENDANCE_COLORS,
  PERMISSIONS as P,
  attendanceCorrectionSchema,
  attendanceQuery,
  compensationRequestSchema,
  decision,
  devicePunchSchema,
  deviceSchema,
  manualPunchSchema,
  overtimeDecisionSchema,
  type DecisionInput,
  type PunchType,
} from '@hrms/shared';
import { and, asc, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { als, currentUser } from '../../common/context';
import { randomToken, sha256 } from '../../common/crypto';
import { Audit, Public, RequireAny, SkipAudit, SkipCsrf, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { localMinutes, monthRange, todayIn, zonedInstant } from '../../common/tz';
import { one, scoped } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ApprovalsService } from '../../core/approvals.service';
import { AuditService } from '../../core/audit.service';
import { ScopeService } from '../../core/scope.service';
import { DbService } from '../../db/db.service';
import {
  attendanceCorrections,
  attendanceDays,
  attendanceDevices,
  compensationRequests,
  deviceSerials,
  departments,
  employees,
  foodAllowanceRules,
  heldPunches,
  overtimeRecords,
} from '../../db/schema';
import { foodEligibleDays } from '../payroll/payroll.logic';
import { AttendanceService } from './attendance.service';
import { scheduledNetMinutes } from './attendance.logic';
import { ONLINE_WINDOW_MS } from './biometric';

const reqList = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(), mine: z.coerce.boolean().optional() });
const dailyQuery = z.object({ date: z.iso.date().optional(), departmentId: z.uuid().optional() });
const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), departmentId: z.uuid().optional() });

@RequireModule('ATTENDANCE')
@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly db: DbService,
    private readonly svc: AttendanceService,
    private readonly approvals: ApprovalsService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  /* ---------------- Biometric devices (C1) ---------------- */

  @RequireModule('BIOMETRIC')
  @Get('devices')
  @RequireAny(P.ATTENDANCE_MANAGE)
  async devices() {
    const rows = await this.db.tx
      .select({
        id: attendanceDevices.id,
        name: attendanceDevices.name,
        protocol: attendanceDevices.protocol,
        serialNumber: attendanceDevices.serialNumber,
        location: attendanceDevices.location,
        apiKeyPrefix: attendanceDevices.apiKeyPrefix,
        lastSeenAt: attendanceDevices.lastSeenAt,
        lastSyncAt: attendanceDevices.lastSyncAt,
        isActive: attendanceDevices.isActive,
        createdAt: attendanceDevices.createdAt,
      })
      .from(attendanceDevices)
      .orderBy(asc(attendanceDevices.name));
    // BIO-07: online / offline and last sync per device.
    return rows.map((d) => ({ ...d, online: d.isActive && !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_WINDOW_MS }));
  }

  /** BIO-02: register a device to this company. Returns the device key once; only its hash is stored. */
  @RequireModule('BIOMETRIC')
  @Post('devices')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.device_created', 'attendance_device')
  async createDevice(@Body(zp(deviceSchema)) body: z.infer<typeof deviceSchema>) {
    const tenantId = currentUser().tenantId;
    const tx = this.db.tx;
    const serial = body.serialNumber?.trim().toUpperCase() || null;
    if (body.protocol === 'ZKTECO_ADMS' && !serial) throw badRequest('Enter the serial number shown in the device menu (System info → Serial number)', 'SERIAL_REQUIRED');
    if (serial) {
      const [taken] = await tx.select({ t: deviceSerials.tenantId }).from(deviceSerials).where(eq(deviceSerials.serialNumber, serial));
      if (taken) throw badRequest('A device with this serial number is already registered', 'SERIAL_TAKEN');
    }
    const secret = randomToken(32);
    const key = `${tenantId}.${secret}`;
    const row = one(
      await tx
        .insert(attendanceDevices)
        .values({ tenantId, name: body.name, protocol: body.protocol, serialNumber: serial, location: body.location, apiKeyHash: sha256(secret), apiKeyPrefix: secret.slice(0, 6) })
        .returning(),
    );
    if (serial) await tx.insert(deviceSerials).values({ serialNumber: serial, tenantId, deviceId: row.id });
    return { id: row.id, name: row.name, protocol: row.protocol, apiKey: key };
  }

  @RequireModule('BIOMETRIC')
  @Delete('devices/:id')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.device_revoked', 'attendance_device')
  async revokeDevice(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx.update(attendanceDevices).set({ isActive: false }).where(eq(attendanceDevices.id, id));
    await this.db.tx.delete(deviceSerials).where(eq(deviceSerials.deviceId, id));
    return { id, revoked: true };
  }

  /** Generic JSON push (custom middleware / older integrations). Auth: `X-Device-Key: <tenantId>.<secret>`. */
  @Public()
  @SkipCsrf()
  @SkipAudit()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @HttpCode(200)
  @Post('device/punches')
  async devicePunches(@Headers('x-device-key') key: string | undefined, @Body(zp(devicePunchSchema)) body: z.infer<typeof devicePunchSchema>) {
    const dot = key?.indexOf('.') ?? -1;
    if (!key || dot !== 36) throw new UnauthorizedException({ message: 'Invalid device key', code: 'DEVICE_AUTH' });
    const tenantId = key.slice(0, 36);
    if (!z.uuid().safeParse(tenantId).success) throw new UnauthorizedException({ message: 'Invalid device key', code: 'DEVICE_AUTH' });
    const store = als.getStore();
    if (store) store.tenantId = tenantId;
    return this.db.inTenant(tenantId, async (tx) => {
      const [device] = await tx.select().from(attendanceDevices).where(eq(attendanceDevices.apiKeyHash, sha256(key.slice(37))));
      if (!device || !device.isActive) throw new UnauthorizedException({ message: 'Invalid device key', code: 'DEVICE_AUTH' });
      const res = await this.svc.ingestDevicePunches(device.id, body.punches.map((p) => ({ deviceUserId: p.employeeCode, at: new Date(p.at), type: p.type ?? null })));
      await this.audit.log(tx, { tenantId, action: 'attendance.device_push', actorLabel: `device:${device.name}`, entityType: 'attendance_device', entityId: device.id, metadata: { protocol: 'GENERIC', ...res } });
      return { received: res.received, accepted: body.punches.filter((p) => !res.unknownDeviceUserIds.includes(p.employeeCode)).length, inserted: res.inserted, held: res.held, unknownEmployeeCodes: res.unknownDeviceUserIds };
    });
  }

  /* ---------------- Held punches: unknown device user IDs (BIO-04) ---------------- */

  @RequireModule('BIOMETRIC')
  @Get('held-punches')
  @RequireAny(P.ATTENDANCE_MANAGE)
  async heldPunchList() {
    return this.db.tx
      .select({
        deviceUserId: heldPunches.deviceUserId,
        punches: sql<number>`count(*)::int`,
        firstAt: sql<Date>`min(${heldPunches.punchedAt})`.mapWith(heldPunches.punchedAt),
        lastAt: sql<Date>`max(${heldPunches.punchedAt})`.mapWith(heldPunches.punchedAt),
        devices: sql<string>`string_agg(distinct ${attendanceDevices.name}, ', ')`,
      })
      .from(heldPunches)
      .leftJoin(attendanceDevices, eq(attendanceDevices.id, heldPunches.deviceId))
      .where(isNull(heldPunches.resolvedAt))
      .groupBy(heldPunches.deviceUserId)
      .orderBy(desc(sql`max(${heldPunches.punchedAt})`));
  }

  /** Link a device user ID to an employee; their held punches are then added to attendance. */
  @RequireModule('BIOMETRIC')
  @Post('held-punches/assign')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.device_user_mapped', 'employee')
  async assignHeld(@Body(zp(z.object({ deviceUserId: z.string().trim().min(1).max(40), employeeId: z.uuid() }))) body: { deviceUserId: string; employeeId: string }) {
    const tx = this.db.tx;
    const emp = one(await tx.select({ id: employees.id, bio: employees.biometricUserId }).from(employees).where(eq(employees.id, body.employeeId)), 'Employee');
    const [other] = await tx.select({ name: employees.fullName }).from(employees).where(and(eq(employees.biometricUserId, body.deviceUserId), sql`${employees.id} <> ${emp.id}`));
    if (other) throw badRequest(`Device user ID ${body.deviceUserId} is already linked to ${other.name}`, 'ALREADY_MAPPED');
    await tx.update(employees).set({ biometricUserId: body.deviceUserId }).where(eq(employees.id, emp.id));
    const held = await tx.select().from(heldPunches).where(and(eq(heldPunches.deviceUserId, body.deviceUserId), isNull(heldPunches.resolvedAt)));
    let inserted = 0;
    for (const deviceId of new Set(held.map((h) => h.deviceId))) {
      const r = await this.svc.ingest(held.filter((h) => h.deviceId === deviceId).map((h) => ({ employeeId: emp.id, at: h.punchedAt, type: h.type as PunchType | null })), 'DEVICE', deviceId);
      inserted += r.inserted;
    }
    await tx.update(heldPunches).set({ resolvedAt: new Date(), resolution: 'ASSIGNED' }).where(and(eq(heldPunches.deviceUserId, body.deviceUserId), isNull(heldPunches.resolvedAt)));
    return { id: emp.id, deviceUserId: body.deviceUserId, released: held.length, inserted };
  }

  @RequireModule('BIOMETRIC')
  @Post('held-punches/discard')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.held_punches_discarded')
  async discardHeld(@Body(zp(z.object({ deviceUserId: z.string().trim().min(1).max(40) }))) body: { deviceUserId: string }) {
    const rows = await this.db.tx
      .update(heldPunches)
      .set({ resolvedAt: new Date(), resolution: 'DISCARDED' })
      .where(and(eq(heldPunches.deviceUserId, body.deviceUserId), isNull(heldPunches.resolvedAt)))
      .returning({ id: heldPunches.id });
    return { discarded: rows.length };
  }

  /** HR bulk import (CSV parsed in the browser into the same shape as device pushes). */
  @Post('import')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.imported')
  async import(@Body(zp(devicePunchSchema)) body: z.infer<typeof devicePunchSchema>) {
    const ids = await this.svc.employeeIdsByCode(body.punches.map((p) => p.employeeCode));
    const valid = body.punches.filter((p) => ids.has(p.employeeCode));
    const res = await this.svc.ingest(valid.map((p) => ({ employeeId: ids.get(p.employeeCode)!, at: new Date(p.at), type: p.type })), 'IMPORT');
    return { ...res, received: body.punches.length, unknownEmployeeCodes: [...new Set(body.punches.filter((p) => !ids.has(p.employeeCode)).map((p) => p.employeeCode))] };
  }

  @Post('punches')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.manual_punch', 'employee')
  manual(@Body(zp(manualPunchSchema)) body: z.infer<typeof manualPunchSchema>) {
    return this.svc.ingest([{ employeeId: body.employeeId, at: new Date(body.at), type: body.type, note: body.note }], 'MANUAL');
  }

  /* ---------------- Records & reports ---------------- */

  @Get('days')
  async days(@Query(zp(attendanceQuery)) q: z.infer<typeof attendanceQuery>) {
    const user = currentUser();
    const employeeId = q.employeeId ?? user.employeeId;
    const visible = await this.scope.visibleEmployeeIds(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM);
    if (employeeId && visible && !visible.includes(employeeId)) throw forbidden();
    const conds: SQL[] = [gte(attendanceDays.date, q.from), lte(attendanceDays.date, q.to)];
    if (employeeId) conds.push(eq(attendanceDays.employeeId, employeeId));
    else {
      const s = scoped(attendanceDays.employeeId, visible);
      if (s) conds.push(s);
    }
    if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
    return this.db.tx
      .select({ day: attendanceDays, employeeName: employees.fullName, employeeCode: employees.employeeCode })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .where(and(...conds))
      .orderBy(desc(attendanceDays.date), asc(employees.fullName))
      .limit(2000)
      .then((rows) => rows.map((r) => ({ ...r.day, employeeName: r.employeeName, employeeCode: r.employeeCode })));
  }

  /** Daily report: every visible active employee's status for one date. */
  @Get('daily')
  @RequireAny(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM)
  async daily(@Query(zp(dailyQuery)) q: z.infer<typeof dailyQuery>) {
    const t = await this.svc.tenant();
    const date = q.date ?? todayIn(t.timezone);
    const visible = await this.scope.visibleEmployeeIds(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM);
    const conds: SQL[] = [eq(employees.employmentStatus, 'ACTIVE')];
    const s = scoped(employees.id, visible);
    if (s) conds.push(s);
    if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
    const rows = await this.db.tx
      .select({
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        fullName: employees.fullName,
        departmentName: departments.name,
        status: attendanceDays.status,
        checkIn: attendanceDays.checkIn,
        checkOut: attendanceDays.checkOut,
        workedMinutes: attendanceDays.workedMinutes,
        lateMinutes: attendanceDays.lateMinutes,
        overtimeMinutes: attendanceDays.overtimeMinutes,
      })
      .from(employees)
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .leftJoin(attendanceDays, and(eq(attendanceDays.employeeId, employees.id), eq(attendanceDays.date, date)))
      .where(and(...conds))
      .orderBy(asc(employees.fullName));
    return { date, rows: rows.map((r) => ({ ...r, status: r.status ?? (date === todayIn(t.timezone) ? 'NOT_IN_YET' : 'NO_RECORD') })) };
  }

  /** Monthly report per employee (C1). */
  @Get('monthly')
  @RequireAny(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM)
  async monthly(@Query(zp(monthQuery)) q: z.infer<typeof monthQuery>) {
    const visible = await this.scope.visibleEmployeeIds(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM);
    const conds: SQL[] = [sql`to_char(${attendanceDays.date}, 'YYYY-MM') = ${q.month}`];
    const s = scoped(attendanceDays.employeeId, visible);
    if (s) conds.push(s);
    if (q.departmentId) conds.push(eq(employees.departmentId, q.departmentId));
    const count = (st: string) => sql<number>`count(*) filter (where ${attendanceDays.status} = ${st})::int`;
    return this.db.tx
      .select({
        employeeId: employees.id,
        employeeCode: employees.employeeCode,
        fullName: employees.fullName,
        departmentName: departments.name,
        present: count('PRESENT'),
        late: count('LATE'),
        absent: count('ABSENT'),
        onLeave: count('ON_LEAVE'),
        halfDay: count('HALF_DAY'),
        workedMinutes: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}), 0)::int`,
        scheduledMinutes: sql<number>`coalesce(sum(${attendanceDays.scheduledMinutes}), 0)::int`,
        lateMinutes: sql<number>`coalesce(sum(${attendanceDays.lateMinutes}), 0)::int`,
        overtimeMinutes: sql<number>`coalesce(sum(${attendanceDays.overtimeMinutes}), 0)::int`,
      })
      .from(attendanceDays)
      .innerJoin(employees, eq(employees.id, attendanceDays.employeeId))
      .innerJoin(departments, eq(departments.id, employees.departmentId))
      .where(and(...conds))
      .groupBy(employees.id, employees.employeeCode, employees.fullName, departments.name)
      .orderBy(asc(employees.fullName));
  }

  @Get('me/summary')
  async mySummary() {
    const employeeId = this.scope.requireEmployee();
    const t = await this.svc.tenant();
    const month = todayIn(t.timezone).slice(0, 7);
    const [agg] = await this.db.tx
      .select({
        present: sql<number>`count(*) filter (where ${attendanceDays.status} in ('PRESENT','LATE','HALF_DAY'))::int`,
        late: sql<number>`count(*) filter (where ${attendanceDays.status} = 'LATE')::int`,
        absent: sql<number>`count(*) filter (where ${attendanceDays.status} = 'ABSENT')::int`,
        onLeave: sql<number>`count(*) filter (where ${attendanceDays.status} = 'ON_LEAVE')::int`,
        workedMinutes: sql<number>`coalesce(sum(${attendanceDays.workedMinutes}), 0)::int`,
        scheduledMinutes: sql<number>`coalesce(sum(${attendanceDays.scheduledMinutes}), 0)::int`,
        overtimeMinutes: sql<number>`coalesce(sum(${attendanceDays.overtimeMinutes}), 0)::int`,
      })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), sql`to_char(${attendanceDays.date}, 'YYYY-MM') = ${month}`));
    const [today] = await this.db.tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), eq(attendanceDays.date, todayIn(t.timezone))));
    return { month, ...agg, today: today ?? null, overtime: await this.svc.overtimeBalance(employeeId) };
  }

  /**
   * Individual attendance dashboard (ADB-01–07). The month changes the summary, figures and charts;
   * `latest` always holds the 5 most recent recorded days.
   */
  @Get('me/dashboard')
  async myDashboard(@Query(zp(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), employeeId: z.uuid().optional() }))) q: { month?: string; employeeId?: string }) {
    const user = currentUser();
    const employeeId = q.employeeId ?? this.scope.requireEmployee();
    if (employeeId !== user.employeeId) {
      const visible = await this.scope.visibleEmployeeIds(P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM);
      if (visible && !visible.includes(employeeId)) throw forbidden();
    }
    const t = await this.svc.tenant();
    const month = q.month ?? todayIn(t.timezone).slice(0, 7);
    const tx = this.db.tx;
    const days = await tx
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), sql`to_char(${attendanceDays.date}, 'YYYY-MM') = ${month}`))
      .orderBy(asc(attendanceDays.date));

    const n = (st: string[]) => days.filter((d) => st.includes(d.status)).length;
    const counts = { present: n(['PRESENT']), late: n(['LATE']), absent: n(['ABSENT']), leave: n(['ON_LEAVE', 'HALF_DAY']) };
    const attended = counts.present + counts.late + n(['HALF_DAY']);
    const base = attended + counts.absent;
    const withIn = days.filter((d) => d.checkIn);
    const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : null);
    const avgIn = avg(withIn.map((d) => localMinutes(d.checkIn!, t.timezone)));

    const [emp] = await tx.select({ departmentId: employees.departmentId }).from(employees).where(eq(employees.id, employeeId));
    const [rule] = emp
      ? await tx.select().from(foodAllowanceRules).innerJoin(departments, eq(departments.id, foodAllowanceRules.departmentId)).where(and(eq(foodAllowanceRules.departmentId, emp.departmentId), eq(foodAllowanceRules.isActive, true), eq(departments.foodAllowanceEnabled, true)))
      : [];
    const foodDays = rule ? foodEligibleDays(rule.food_allowance_rules, days) : null;

    // 6-month trend ending at the selected month.
    const [y, m] = month.split('-').map(Number) as [number, number];
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (5 - i), 1)); return d.toISOString().slice(0, 7); });
    const trendRows = await tx
      .select({
        month: sql<string>`to_char(${attendanceDays.date}, 'YYYY-MM')`,
        attended: sql<number>`count(*) filter (where ${attendanceDays.status} in ('PRESENT','LATE','HALF_DAY'))::int`,
        absent: sql<number>`count(*) filter (where ${attendanceDays.status} = 'ABSENT')::int`,
        late: sql<number>`count(*) filter (where ${attendanceDays.status} = 'LATE')::int`,
      })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, `${months[0]}-01`), lte(attendanceDays.date, monthRange(month).to)))
      .groupBy(sql`to_char(${attendanceDays.date}, 'YYYY-MM')`);
    const trend = months.map((mo) => {
      const r = trendRows.find((x) => x.month === mo);
      const b = (r?.attended ?? 0) + (r?.absent ?? 0);
      return { month: mo, percentage: b ? Math.round(((r?.attended ?? 0) / b) * 1000) / 10 : null, late: r?.late ?? 0 };
    });

    const latest = await tx
      .select({ date: attendanceDays.date, status: attendanceDays.status, checkIn: attendanceDays.checkIn, checkOut: attendanceDays.checkOut, workedMinutes: attendanceDays.workedMinutes, breakMinutes: attendanceDays.breakMinutes, overtimeMinutes: attendanceDays.overtimeMinutes, lateMinutes: attendanceDays.lateMinutes })
      .from(attendanceDays)
      .where(and(eq(attendanceDays.employeeId, employeeId), sql`${attendanceDays.status} not in ('WEEKEND', 'HOLIDAY')`))
      .orderBy(desc(attendanceDays.date))
      .limit(5);

    // Shift shown in the summary header and as the reference line on the daily chart.
    const shift = await this.svc.scheduleFor(employeeId);
    const [ot] = await tx
      .select({ m: sql<number>`coalesce(sum(coalesce(${overtimeRecords.approvedMinutes}, ${overtimeRecords.minutes})), 0)::int` })
      .from(overtimeRecords)
      .where(and(eq(overtimeRecords.employeeId, employeeId), eq(overtimeRecords.status, 'APPROVED'), sql`to_char(${overtimeRecords.date}, 'YYYY-MM') = ${month}`));
    const workedDays = days.filter((d) => d.workedMinutes > 0);

    return {
      month,
      percentage: base ? Math.round((attended / base) * 1000) / 10 : null,
      daysRecorded: days.filter((d) => d.status !== 'WEEKEND' && d.status !== 'HOLIDAY').length,
      counts,
      figures: {
        workedMinutes: days.reduce((a, d) => a + d.workedMinutes, 0),
        scheduledMinutes: days.reduce((a, d) => a + d.scheduledMinutes, 0),
        overtimeMinutes: days.reduce((a, d) => a + d.overtimeMinutes, 0),
        lateMinutes: days.reduce((a, d) => a + d.lateMinutes, 0),
        averageCheckIn: avgIn === null ? null : `${String(Math.floor(avgIn / 60)).padStart(2, '0')}:${String(avgIn % 60).padStart(2, '0')}`,
        averageBreakMinutes: avg(withIn.map((d) => d.breakMinutes)),
        averageWorkedMinutes: avg(workedDays.map((d) => d.workedMinutes)),
        approvedOvertimeMinutes: ot?.m ?? 0,
        foodEligibleDays: foodDays,
      },
      shift: { start: String(shift.startTime).slice(0, 5), end: String(shift.endTime).slice(0, 5), minutes: scheduledNetMinutes(shift) },
      daily: days.filter((d) => d.status !== 'WEEKEND' && d.status !== 'HOLIDAY').map((d) => ({ date: d.date, status: d.status, workedMinutes: d.workedMinutes, scheduledMinutes: d.scheduledMinutes })),
      trend,
      latest,
      colors: ATTENDANCE_COLORS,
    };
  }

  /** Mark a day as work-from-home (affects food allowance eligibility, D4). */
  @Post('days/flags')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.day_flagged', 'employee')
  async flagDay(@Body(zp(z.object({ employeeId: z.uuid(), date: z.iso.date(), workFromHome: z.boolean(), notes: z.string().trim().max(300).optional() }))) body: { employeeId: string; date: string; workFromHome: boolean; notes?: string }) {
    await this.svc.recompute(body.employeeId, body.date, body.date);
    const [row] = await this.db.tx
      .update(attendanceDays)
      .set({ workFromHome: body.workFromHome, notes: body.notes })
      .where(and(eq(attendanceDays.employeeId, body.employeeId), eq(attendanceDays.date, body.date)))
      .returning();
    if (!row) throw badRequest('No attendance record for that day yet');
    return row;
  }

  @Post('recompute')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.recomputed')
  async recompute(@Body(zp(z.object({ employeeId: z.uuid(), from: z.iso.date(), to: z.iso.date() }))) body: { employeeId: string; from: string; to: string }) {
    await this.svc.recompute(body.employeeId, body.from, body.to);
    return { ok: true };
  }

  /* ---------------- Corrections (Team Lead → HR) ---------------- */

  @Get('corrections')
  async corrections(@Query(zp(reqList)) q: z.infer<typeof reqList>) {
    const user = currentUser();
    const visible = q.mine ? [this.scope.requireEmployee()] : await this.scope.visibleEmployeeIds(P.ATTENDANCE_CORRECTION_APPROVE_HR, P.ATTENDANCE_CORRECTION_APPROVE_TL);
    const conds: SQL[] = [];
    const s = scoped(attendanceCorrections.employeeId, visible);
    if (s) conds.push(s);
    if (q.status) conds.push(eq(attendanceCorrections.status, q.status));
    const rows = await this.db.tx
      .select({ c: attendanceCorrections, employeeName: employees.fullName })
      .from(attendanceCorrections)
      .innerJoin(employees, eq(employees.id, attendanceCorrections.employeeId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(attendanceCorrections.createdAt))
      .limit(500);
    return Promise.all(rows.map(async (r) => ({ ...r.c, employeeName: r.employeeName, canDecide: r.c.employeeId !== user.employeeId && (await this.approvals.canDecide('ATTENDANCE_CORRECTION', r.c)) })));
  }

  @Post('corrections')
  @Audit('attendance.correction_requested', 'attendance_correction')
  async requestCorrection(@Body(zp(attendanceCorrectionSchema)) body: z.infer<typeof attendanceCorrectionSchema>) {
    const employeeId = this.scope.requireEmployee();
    const t = await this.svc.tenant();
    if (body.date > todayIn(t.timezone)) throw badRequest('You can only correct past or current days');
    const row = one(await this.db.tx.insert(attendanceCorrections).values({ tenantId: t.id, employeeId, ...body }).returning());
    const wf = await this.approvals.submit('ATTENDANCE_CORRECTION', row.id, employeeId, { title: `Attendance correction for ${body.date}`, link: '/attendance/corrections' });
    await this.db.tx.update(attendanceCorrections).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(attendanceCorrections.id, row.id));
    if (wf.status === 'APPROVED') await this.applyCorrection(row.id);
    return { ...row, status: wf.status, currentStep: wf.currentStep };
  }

  private async applyCorrection(id: string) {
    const c = one(await this.db.tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)));
    const t = await this.svc.tenant();
    const punches = [];
    if (c.checkIn) punches.push({ employeeId: c.employeeId, at: zonedInstant(c.date, c.checkIn.slice(0, 5), t.timezone), type: 'IN' as const, note: `Correction ${c.id}` });
    if (c.checkOut) punches.push({ employeeId: c.employeeId, at: zonedInstant(c.date, c.checkOut.slice(0, 5), t.timezone), type: 'OUT' as const, note: `Correction ${c.id}` });
    await this.svc.ingest(punches, 'CORRECTION');
  }

  /**
   * HR / Company Admin fix a day directly (no approval needed for people who manage attendance).
   * Stored as correction punches, so the original device punches stay in the history and the audit log.
   */
  @Post('days/correct')
  @RequireAny(P.ATTENDANCE_MANAGE)
  @Audit('attendance.corrected_directly', 'employee')
  async correctDirectly(@Body(zp(z.object({
    employeeId: z.uuid(),
    date: z.iso.date(),
    checkIn: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    checkOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    note: z.string().trim().min(3).max(300),
  }))) body: { employeeId: string; date: string; checkIn?: string; checkOut?: string; note: string }) {
    if (!body.checkIn && !body.checkOut) throw badRequest('Enter a check-in or check-out time');
    if (body.checkIn && body.checkOut && body.checkOut <= body.checkIn) throw badRequest('Check-out must be after check-in');
    const t = await this.svc.tenant();
    if (body.date > todayIn(t.timezone)) throw badRequest('You cannot correct a future day');
    const note = `Corrected by ${currentUser().email}: ${body.note}`;
    const punches = [];
    if (body.checkIn) punches.push({ employeeId: body.employeeId, at: zonedInstant(body.date, body.checkIn, t.timezone), type: 'IN' as const, note });
    if (body.checkOut) punches.push({ employeeId: body.employeeId, at: zonedInstant(body.date, body.checkOut, t.timezone), type: 'OUT' as const, note });
    await this.svc.ingest(punches, 'CORRECTION');
    const [day] = await this.db.tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, body.employeeId), eq(attendanceDays.date, body.date)));
    return { id: body.employeeId, day: day ?? null };
  }

  @Post('corrections/:id/decision')
  @Audit('attendance.correction_decided', 'attendance_correction')
  async decideCorrection(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const c = one(await this.db.tx.select().from(attendanceCorrections).where(eq(attendanceCorrections.id, id)), 'Correction');
    const wf = await this.approvals.decide('ATTENDANCE_CORRECTION', c, body.approve, body.comment, { title: `Attendance correction for ${c.date}`, link: '/attendance/corrections' });
    await this.db.tx.update(attendanceCorrections).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(attendanceCorrections.id, id));
    if (wf.status === 'APPROVED') await this.applyCorrection(id);
    return { id, status: wf.status, currentStep: wf.currentStep };
  }

  /* ---------------- Overtime (Team Lead approval, C2) ---------------- */

  @Get('overtime')
  async overtime(@Query(zp(reqList)) q: z.infer<typeof reqList>) {
    const user = currentUser();
    const visible = q.mine ? [this.scope.requireEmployee()] : await this.scope.visibleEmployeeIds(P.ATTENDANCE_READ_ALL, P.OVERTIME_APPROVE_TL);
    const conds: SQL[] = [];
    const s = scoped(overtimeRecords.employeeId, visible);
    if (s) conds.push(s);
    if (q.status) conds.push(eq(overtimeRecords.status, q.status));
    const rows = await this.db.tx
      .select({ o: overtimeRecords, employeeName: employees.fullName })
      .from(overtimeRecords)
      .innerJoin(employees, eq(employees.id, overtimeRecords.employeeId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(overtimeRecords.date))
      .limit(500);
    return Promise.all(rows.map(async (r) => ({ ...r.o, employeeName: r.employeeName, canDecide: r.o.employeeId !== user.employeeId && (await this.approvals.canDecide('OVERTIME', r.o)) })));
  }

  @Post('overtime/:id/decision')
  @Audit('attendance.overtime_decided', 'overtime')
  async decideOvertime(@Param('id', ParseUUIDPipe) id: string, @Body(zp(overtimeDecisionSchema)) body: z.infer<typeof overtimeDecisionSchema>) {
    const o = one(await this.db.tx.select().from(overtimeRecords).where(eq(overtimeRecords.id, id)), 'Overtime record');
    const wf = await this.approvals.decide('OVERTIME', o, body.approve, body.comment, { title: `Overtime on ${o.date}`, link: '/attendance/overtime' });
    await this.db.tx
      .update(overtimeRecords)
      .set({
        status: wf.status,
        currentStep: wf.currentStep,
        workDescription: body.workDescription,
        approvedMinutes: body.approve ? Math.min(body.approvedMinutes ?? o.minutes, o.minutes) : 0,
      })
      .where(eq(overtimeRecords.id, id));
    return { id, status: wf.status };
  }

  /* ---------------- Compensation requests (Team Lead → HR, C2) ---------------- */

  @Get('compensation')
  async compensation(@Query(zp(reqList)) q: z.infer<typeof reqList>) {
    const user = currentUser();
    const visible = q.mine ? [this.scope.requireEmployee()] : await this.scope.visibleEmployeeIds(P.COMPENSATION_APPROVE_HR, P.COMPENSATION_APPROVE_TL);
    const conds: SQL[] = [];
    const s = scoped(compensationRequests.employeeId, visible);
    if (s) conds.push(s);
    if (q.status) conds.push(eq(compensationRequests.status, q.status));
    const rows = await this.db.tx
      .select({ c: compensationRequests, employeeName: employees.fullName })
      .from(compensationRequests)
      .innerJoin(employees, eq(employees.id, compensationRequests.employeeId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(compensationRequests.createdAt))
      .limit(500);
    return Promise.all(rows.map(async (r) => ({ ...r.c, employeeName: r.employeeName, canDecide: r.c.employeeId !== user.employeeId && (await this.approvals.canDecide('COMPENSATION', r.c)) })));
  }

  @Get('compensation/balance')
  balance() {
    return this.svc.overtimeBalance(this.scope.requireEmployee());
  }

  @Post('compensation')
  @Audit('attendance.compensation_requested', 'compensation_request')
  async requestCompensation(@Body(zp(compensationRequestSchema)) body: z.infer<typeof compensationRequestSchema>) {
    const employeeId = this.scope.requireEmployee();
    const tx = this.db.tx;
    const [emp] = await tx.select({ paid: departments.paidOvertimeEnabled }).from(employees).innerJoin(departments, eq(departments.id, employees.departmentId)).where(eq(employees.id, employeeId));
    if (body.type === 'PAID' && !emp?.paid) throw badRequest('Paid overtime compensation is not available in your department', 'NOT_AVAILABLE');
    const bal = await this.svc.overtimeBalance(employeeId);
    const minutes = body.type === 'HALF_DAY' ? Math.round(bal.dayMinutes / 2) : body.minutes;
    if (body.type === 'REDUCED_HOURS') {
      // OVT-07: shorten an upcoming working day, never by more than the full shift.
      if (body.date! < todayIn((await this.svc.tenant()).timezone)) throw badRequest('Pick today or a future working day', 'DATE_IN_PAST');
      if (minutes > bal.dayMinutes) throw badRequest('You can reduce a day by at most one full shift', 'TOO_MANY_MINUTES');
    }
    if (minutes > bal.availableMinutes) throw badRequest(`Not enough approved overtime (available: ${Math.floor(bal.availableMinutes / 60)}h ${bal.availableMinutes % 60}m)`, 'INSUFFICIENT_OVERTIME');
    const row = one(await tx.insert(compensationRequests).values({ tenantId: currentUser().tenantId, employeeId, type: body.type, minutes, date: body.date, reason: body.reason }).returning());
    const title = body.type === 'PAID' ? 'Paid overtime compensation' : body.type === 'HALF_DAY' ? 'Half-day compensation' : 'Shorter working day (overtime adjustment)';
    const wf = await this.approvals.submit('COMPENSATION', row.id, employeeId, { title, link: '/attendance/overtime' });
    await tx.update(compensationRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(compensationRequests.id, row.id));
    return { ...row, status: wf.status, currentStep: wf.currentStep };
  }

  @Post('compensation/:id/decision')
  @Audit('attendance.compensation_decided', 'compensation_request')
  async decideCompensation(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const c = one(await this.db.tx.select().from(compensationRequests).where(eq(compensationRequests.id, id)), 'Compensation request');
    const wf = await this.approvals.decide('COMPENSATION', c, body.approve, body.comment, { title: 'Overtime compensation', link: '/attendance/overtime' });
    await this.db.tx.update(compensationRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(compensationRequests.id, id));
    if (wf.status === 'APPROVED' && (c.type === 'HALF_DAY' || c.type === 'REDUCED_HOURS') && c.date) await this.svc.recompute(c.employeeId, c.date, c.date);
    return { id, status: wf.status, currentStep: wf.currentStep };
  }
}
