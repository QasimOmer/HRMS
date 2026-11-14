import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  ATTENDANCE_COLORS,
  PERMISSIONS as P,
  calendarEventSchema,
  calendarQuery,
  decision,
  holidaySchema,
  leaveAllocationSchema,
  leaveCancelSchema,
  leaveRequestSchema,
  leaveTypeSchema,
  type DecisionInput,
  type LeaveRequestInput,
} from '@hrms/shared';
import { and, asc, desc, eq, gte, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '../../common/context';
import { Audit, RequireAny, RequireModule } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { monthRange, todayIn } from '../../common/tz';
import { one, scoped, requireDelete, assertUnused, countWhere } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { ApprovalsService } from '../../core/approvals.service';
import { NotificationsService } from '../../core/notifications.service';
import { ScopeService } from '../../core/scope.service';
import { DbService } from '../../db/db.service';
import {
  attendanceDays,
  calendarEvents,
  departments,
  employees,
  holidays,
  leaveAllocations,
  leaveRequests,
  leaveTypes,
  overtimeRecords,
} from '../../db/schema';
import { AttendanceService } from '../attendance/attendance.service';
import { LeaveService } from './leave.service';

const listQuery = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  mine: z.coerce.boolean().optional(),
  employeeId: z.uuid().optional(),
  year: z.coerce.number().int().optional(),
});

@RequireModule('LEAVE')
@Controller()
export class LeaveController {
  constructor(
    private readonly db: DbService,
    private readonly svc: LeaveService,
    private readonly attendance: AttendanceService,
    private readonly approvals: ApprovalsService,
    private readonly scope: ScopeService,
    private readonly notify: NotificationsService,
  ) {}

  /* ---------------- Leave types & allocations ---------------- */

  @Get('leave/types')
  types() {
    return this.db.tx.select().from(leaveTypes).orderBy(asc(leaveTypes.code));
  }

  @Post('leave/types')
  @RequireAny(P.LEAVE_MANAGE)
  @Audit('leave.type_created', 'leave_type')
  async createType(@Body(zp(leaveTypeSchema)) body: z.infer<typeof leaveTypeSchema>) {
    return one(await this.db.tx.insert(leaveTypes).values({ ...body, tenantId: currentUser().tenantId }).returning());
  }

  @Put('leave/types/:id')
  @RequireAny(P.LEAVE_MANAGE)
  @Audit('leave.type_updated', 'leave_type')
  async updateType(@Param('id', ParseUUIDPipe) id: string, @Body(zp(leaveTypeSchema)) body: z.infer<typeof leaveTypeSchema>) {
    return one(await this.db.tx.update(leaveTypes).set(body).where(eq(leaveTypes.id, id)).returning(), 'Leave type');
  }

  @Delete('leave/types/:id')
  @RequireAny(P.LEAVE_MANAGE)
  @Audit('leave.type_deleted', 'leave_type')
  async removeType(@Param('id', ParseUUIDPipe) id: string) {
    requireDelete();
    const tx = this.db.tx;
    one(await tx.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.id, id)), 'Leave type');
    assertUnused('This leave type', [
      [await countWhere(tx, leaveRequests, eq(leaveRequests.leaveTypeId, id)), 'leave request(s)'],
      [await countWhere(tx, leaveAllocations, eq(leaveAllocations.leaveTypeId, id)), 'balance adjustment(s)'],
    ]);
    await tx.delete(leaveTypes).where(eq(leaveTypes.id, id));
    return { id, deleted: true };
  }

  @Post('leave/allocations')
  @RequireAny(P.LEAVE_MANAGE)
  @Audit('leave.allocation_adjusted', 'employee')
  async allocate(@Body(zp(leaveAllocationSchema)) body: z.infer<typeof leaveAllocationSchema>) {
    const u = currentUser();
    return one(await this.db.tx.insert(leaveAllocations).values({ ...body, tenantId: u.tenantId, createdByUserId: u.userId }).returning());
  }

  @Get('leave/balances')
  async balances(@Query(zp(z.object({ employeeId: z.uuid().optional(), year: z.coerce.number().int().optional() }))) q: { employeeId?: string; year?: number }) {
    const employeeId = q.employeeId ?? this.scope.requireEmployee();
    await this.scope.assertCanView(employeeId, P.LEAVE_APPROVE_HR, P.LEAVE_APPROVE_TL);
    const t = await this.attendance.tenant();
    return this.svc.balances(employeeId, q.year ?? Number(todayIn(t.timezone).slice(0, 4)));
  }

  /* ---------------- Requests (Team Lead → HR, C3) ---------------- */

  @Get('leave/requests')
  async list(@Query(zp(listQuery)) q: z.infer<typeof listQuery>) {
    const user = currentUser();
    let visible: string[] | null;
    if (q.mine) visible = [this.scope.requireEmployee()];
    else visible = await this.scope.visibleEmployeeIds(P.LEAVE_APPROVE_HR, P.LEAVE_APPROVE_TL);
    if (q.employeeId) {
      if (visible && !visible.includes(q.employeeId)) throw forbidden();
      visible = [q.employeeId];
    }
    const conds: SQL[] = [];
    const s = scoped(leaveRequests.employeeId, visible);
    if (s) conds.push(s);
    if (q.status) conds.push(eq(leaveRequests.status, q.status));
    if (q.year) conds.push(sql`extract(year from ${leaveRequests.startDate}) = ${q.year}`);
    const rows = await this.db.tx
      .select({ r: leaveRequests, employeeName: employees.fullName, typeName: leaveTypes.name, typeColor: leaveTypes.color })
      .from(leaveRequests)
      .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(leaveRequests.createdAt))
      .limit(500);
    return Promise.all(
      rows.map(async (r) => ({
        ...r.r,
        employeeName: r.employeeName,
        typeName: r.typeName,
        typeColor: r.typeColor,
        canDecide: r.r.employeeId !== user.employeeId && (await this.approvals.canDecide('LEAVE', r.r)),
        canDecideCancellation: r.r.cancellationStatus === 'REQUESTED' && user.permissions.has(P.LEAVE_MANAGE),
      })),
    );
  }

  @Post('leave/requests')
  @Audit('leave.requested', 'leave_request')
  async apply(@Body(zp(leaveRequestSchema)) body: LeaveRequestInput) {
    const employeeId = this.scope.requireEmployee();
    const { type, days } = await this.svc.validateRequest(employeeId, body);
    const tx = this.db.tx;
    const row = one(await tx.insert(leaveRequests).values({ tenantId: currentUser().tenantId, employeeId, ...body, days }).returning());
    const title = `${type.name} (${days} day${days === 1 ? '' : 's'})`;
    const wf = await this.approvals.submit('LEAVE', row.id, employeeId, { title, link: '/leave' });
    await tx.update(leaveRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(leaveRequests.id, row.id));
    if (wf.status === 'APPROVED') await this.svc.syncAttendance(employeeId, row.startDate, row.endDate);
    return { ...row, status: wf.status, currentStep: wf.currentStep };
  }

  @Post('leave/requests/:id/decision')
  @Audit('leave.decided', 'leave_request')
  async decide(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const tx = this.db.tx;
    const r = one(await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)), 'Leave request');
    const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, r.leaveTypeId));
    const wf = await this.approvals.decide('LEAVE', r, body.approve, body.comment, { title: `${type?.name ?? 'Leave'} (${r.days} days)`, link: '/leave' });
    await tx.update(leaveRequests).set({ status: wf.status, currentStep: wf.currentStep }).where(eq(leaveRequests.id, id));
    if (wf.status === 'APPROVED') await this.svc.syncAttendance(r.employeeId, r.startDate, r.endDate);
    return { id, status: wf.status, currentStep: wf.currentStep };
  }

  /**
   * C3 cancellation: pending requests are withdrawn immediately; approved ones go to HR
   * (email notification) who confirms the cancellation.
   */
  @Post('leave/requests/:id/cancel')
  @Audit('leave.cancel_requested', 'leave_request')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body(zp(leaveCancelSchema)) body: z.infer<typeof leaveCancelSchema>) {
    const tx = this.db.tx;
    const r = one(await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)), 'Leave request');
    if (r.employeeId !== currentUser().employeeId) throw forbidden();
    if (r.status === 'PENDING') {
      await tx.update(leaveRequests).set({ status: 'CANCELLED', currentStep: null, cancellationReason: body.reason }).where(eq(leaveRequests.id, id));
      await this.approvals.recordCancel('LEAVE', id, body.reason);
      return { id, status: 'CANCELLED' };
    }
    if (r.status !== 'APPROVED') throw badRequest('Only pending or approved leave can be cancelled');
    if (r.cancellationStatus === 'REQUESTED') throw badRequest('Cancellation already requested');
    await tx.update(leaveRequests).set({ cancellationStatus: 'REQUESTED', cancellationReason: body.reason }).where(eq(leaveRequests.id, id));
    const [emp] = await tx.select({ name: employees.fullName }).from(employees).where(eq(employees.id, r.employeeId));
    await this.notify.notifyPermission(P.LEAVE_MANAGE, {
      type: 'leave.cancellation_requested',
      title: `Leave cancellation request from ${emp?.name}`,
      body: `${r.startDate} → ${r.endDate}. Reason: ${body.reason}`,
      link: '/leave/approvals',
      email: true, // C3 / G4: HR receives an email notification
    });
    return { id, status: r.status, cancellationStatus: 'REQUESTED' };
  }

  @Post('leave/requests/:id/cancellation-decision')
  @RequireAny(P.LEAVE_MANAGE)
  @Audit('leave.cancellation_decided', 'leave_request')
  async cancellationDecision(@Param('id', ParseUUIDPipe) id: string, @Body(zp(decision)) body: DecisionInput) {
    const tx = this.db.tx;
    const r = one(await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)), 'Leave request');
    if (r.cancellationStatus !== 'REQUESTED') throw badRequest('No cancellation pending');
    if (body.approve) {
      await tx.update(leaveRequests).set({ status: 'CANCELLED', cancellationStatus: 'APPROVED' }).where(eq(leaveRequests.id, id));
      await this.approvals.recordCancel('LEAVE', id, body.comment);
      await this.svc.syncAttendance(r.employeeId, r.startDate, r.endDate);
    } else {
      await tx.update(leaveRequests).set({ cancellationStatus: 'REJECTED' }).where(eq(leaveRequests.id, id));
    }
    await this.notify.notifyEmployees([r.employeeId], {
      type: 'leave.cancellation_decided',
      title: body.approve ? 'Your leave was cancelled' : 'Your leave cancellation was declined',
      body: body.comment,
      link: '/leave',
    });
    return { id, cancelled: body.approve };
  }

  @Get('leave/requests/:id/history')
  async history(@Param('id', ParseUUIDPipe) id: string) {
    const r = one(await this.db.tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)), 'Leave request');
    await this.scope.assertCanView(r.employeeId, P.LEAVE_APPROVE_HR, P.LEAVE_APPROVE_TL);
    return this.approvals.history('LEAVE', id);
  }

  /* ---------------- Holidays (C4) ---------------- */

  @RequireModule('CORE')
  @Get('holidays')
  holidays(@Query(zp(z.object({ year: z.coerce.number().int().optional() }))) q: { year?: number }) {
    const base = this.db.tx.select({ h: holidays, departmentName: departments.name }).from(holidays).leftJoin(departments, eq(departments.id, holidays.departmentId));
    return (q.year ? base.where(sql`extract(year from ${holidays.date}) = ${q.year}`) : base)
      .orderBy(asc(holidays.date))
      .then((rows) => rows.map((r) => ({ ...r.h, departmentName: r.departmentName })));
  }

  @RequireModule('CORE')
  @Post('holidays')
  @RequireAny(P.HOLIDAYS_MANAGE)
  @Audit('holiday.created', 'holiday')
  async createHoliday(@Body(zp(holidaySchema)) body: z.infer<typeof holidaySchema>) {
    return one(await this.db.tx.insert(holidays).values({ ...body, tenantId: currentUser().tenantId }).returning());
  }

  @RequireModule('CORE')
  @Delete('holidays/:id')
  @RequireAny(P.HOLIDAYS_MANAGE)
  @Audit('holiday.deleted', 'holiday')
  async deleteHoliday(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx.delete(holidays).where(eq(holidays.id, id));
    return { id, deleted: true };
  }

  /* ---------------- Company calendar (C5) ---------------- */

  @RequireModule('CORE')
  @Post('calendar/events')
  @RequireAny(P.CALENDAR_MANAGE)
  @Audit('calendar.event_created', 'calendar_event')
  async createEvent(@Body(zp(calendarEventSchema)) body: z.infer<typeof calendarEventSchema>) {
    const u = currentUser();
    return one(await this.db.tx.insert(calendarEvents).values({ ...body, departmentId: body.visibility === 'COMPANY' ? null : body.departmentId, tenantId: u.tenantId, createdByUserId: u.userId }).returning());
  }

  @RequireModule('CORE')
  @Delete('calendar/events/:id')
  @RequireAny(P.CALENDAR_MANAGE)
  @Audit('calendar.event_deleted', 'calendar_event')
  async deleteEvent(@Param('id', ParseUUIDPipe) id: string) {
    await this.db.tx.delete(calendarEvents).where(eq(calendarEvents.id, id));
    return { id, deleted: true };
  }

  @RequireModule('CORE')
  @Get('calendar')
  async calendar(@Query(zp(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    const user = currentUser();
    const tx = this.db.tx;
    const { from, to } = monthRange(q.month);
    const employeeId = q.employeeId ?? user.employeeId;
    if (employeeId && employeeId !== user.employeeId) await this.scope.assertCanView(employeeId, P.ATTENDANCE_READ_ALL, P.ATTENDANCE_READ_TEAM);
    const [emp] = employeeId ? await tx.select().from(employees).where(eq(employees.id, employeeId)) : [];
    const departmentId = q.departmentId ?? emp?.departmentId ?? null;
    const canSeeAllDepts = user.permissions.has(P.CALENDAR_MANAGE);
    if (q.departmentId && !canSeeAllDepts && q.departmentId !== emp?.departmentId) throw forbidden('Department calendars are only visible to their members');

    const deptCond = departmentId ? or(isNull(holidays.departmentId), eq(holidays.departmentId, departmentId)) : isNull(holidays.departmentId);
    const [hols, events, days, leaves, overtime, birthdays] = await Promise.all([
      tx.select().from(holidays).where(and(gte(holidays.date, from), lte(holidays.date, to), deptCond)),
      tx
        .select()
        .from(calendarEvents)
        .where(
          and(
            lte(calendarEvents.startDate, to),
            gte(calendarEvents.endDate, from),
            departmentId ? or(eq(calendarEvents.visibility, 'COMPANY'), eq(calendarEvents.departmentId, departmentId)) : eq(calendarEvents.visibility, 'COMPANY'),
          ),
        ),
      employeeId
        ? tx.select().from(attendanceDays).where(and(eq(attendanceDays.employeeId, employeeId), gte(attendanceDays.date, from), lte(attendanceDays.date, to)))
        : Promise.resolve([]),
      employeeId
        ? tx
            .select({ r: leaveRequests, typeName: leaveTypes.name, color: leaveTypes.color })
            .from(leaveRequests)
            .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
            .where(and(eq(leaveRequests.employeeId, employeeId), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from)))
        : Promise.resolve([]),
      employeeId
        ? tx.select().from(overtimeRecords).where(and(eq(overtimeRecords.employeeId, employeeId), gte(overtimeRecords.date, from), lte(overtimeRecords.date, to)))
        : Promise.resolve([]),
      tx
        .select({ id: employees.id, fullName: employees.fullName, dateOfBirth: employees.dateOfBirth, avatarFileId: employees.avatarFileId })
        .from(employees)
        .where(and(eq(employees.employmentStatus, 'ACTIVE'), sql`extract(month from ${employees.dateOfBirth}) = ${Number(q.month.slice(5, 7))}`)),
    ]);
    return {
      month: q.month,
      employeeId,
      departmentId,
      colors: ATTENDANCE_COLORS,
      holidays: hols,
      events,
      attendance: days.map((d) => ({ date: d.date, status: d.status, workedMinutes: d.workedMinutes, overtimeMinutes: d.overtimeMinutes, lateMinutes: d.lateMinutes, checkIn: d.checkIn, checkOut: d.checkOut })),
      leaves: leaves.map((l) => ({ id: l.r.id, startDate: l.r.startDate, endDate: l.r.endDate, status: l.r.status, currentStep: l.r.currentStep, cancellationStatus: l.r.cancellationStatus, typeName: l.typeName, color: l.color, halfDay: l.r.halfDay })),
      overtime: overtime.map((o) => ({ date: o.date, minutes: o.approvedMinutes ?? o.minutes, status: o.status })),
      birthdays: birthdays.map((b) => ({ id: b.id, fullName: b.fullName, day: Number(b.dateOfBirth!.slice(8, 10)), avatarFileId: b.avatarFileId })),
    };
  }
}
