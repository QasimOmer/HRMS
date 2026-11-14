import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  PERMISSIONS as P,
  employeeListQuery,
  employeeSchema,
  employeeUpdateSchema,
  promotionSchema,
  selfProfileSchema,
  terminateSchema,
  selfProfileUpdateSchema,
  type SelfProfileUpdateInput,
  reactivateSchema,
  type EmployeeInput,
  type EmployeeUpdateInput,
  type PromotionInput,
} from '@hrms/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '../../common/context';
import { Audit, RequireAny } from '../../common/decorators';
import { one } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { NotificationsService } from '../../core/notifications.service';
import { DbService } from '../../db/db.service';
import { employees } from '../../db/schema';
import { EmployeesService } from './employees.service';

const directoryQuery = z.object({ search: z.string().trim().max(100).optional(), departmentId: z.uuid().optional() });

@Controller()
export class EmployeesController {
  constructor(
    private readonly svc: EmployeesService,
    private readonly db: DbService,
    private readonly notify: NotificationsService,
  ) {}

  @Get('employees')
  @RequireAny(P.EMPLOYEES_READ_ALL, P.EMPLOYEES_READ_TEAM)
  list(@Query(zp(employeeListQuery)) q: z.infer<typeof employeeListQuery>) {
    return this.svc.list(q);
  }

  @Post('employees')
  @RequireAny(P.EMPLOYEES_MANAGE)
  @Audit('employee.created', 'employee')
  create(@Body(zp(employeeSchema)) body: EmployeeInput) {
    return this.svc.create(body);
  }

  @Get('employees/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(id);
  }

  /** HR edits any field, including the ones employees can't (B1, B2). */
  @Patch('employees/:id')
  @RequireAny(P.EMPLOYEES_MANAGE)
  @Audit('employee.updated', 'employee')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(zp(employeeUpdateSchema)) body: EmployeeUpdateInput) {
    return this.svc.update(id, body);
  }

  @Post('employees/:id/terminate')
  @RequireAny(P.EMPLOYEES_MANAGE)
  @Audit('employee.terminated', 'employee')
  async terminate(@Param('id', ParseUUIDPipe) id: string, @Body(zp(terminateSchema)) body: z.infer<typeof terminateSchema>) {
    const emp = one(
      await this.db.tx.update(employees).set({ employmentStatus: 'TERMINATED', exitDate: body.exitDate }).where(eq(employees.id, id)).returning(),
      'Employee',
    );
    if (emp.userId) await this.svc.disableUser(emp.userId);
    return emp;
  }

  /** Give a former employee their place (and optionally their login) back. Their records were never removed. */
  @Post('employees/:id/reactivate')
  @RequireAny(P.EMPLOYEES_MANAGE)
  @Audit('employee.reactivated', 'employee')
  reactivate(@Param('id', ParseUUIDPipe) id: string, @Body(zp(reactivateSchema)) body: z.infer<typeof reactivateSchema>) {
    return this.svc.reactivate(id, body.restoreLogin);
  }

  /** Permanent delete of a former employee (needs "Delete records" too). */
  @Delete('employees/:id')
  @RequireAny(P.EMPLOYEES_MANAGE)
  @Audit('employee.deleted', 'employee')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(id);
  }

  @Get('me/profile')
  me() {
    const id = currentUser().employeeId;
    return id ? this.svc.get(id) : null;
  }

  @Patch('me/profile')
  @Audit('employee.self_updated', 'employee')
  updateSelf(@Body(zp(selfProfileUpdateSchema)) body: SelfProfileUpdateInput) {
    return this.svc.updateSelf(body);
  }

  @Get('employees/:id/positions')
  positions(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.positions(id);
  }

  @Post('employees/:id/promotions')
  @RequireAny(P.PROMOTIONS_MANAGE)
  @Audit('employee.promoted', 'employee')
  promote(@Param('id', ParseUUIDPipe) id: string, @Body(zp(promotionSchema)) body: PromotionInput) {
    return this.svc.promote(id, body);
  }

  /** B8 – recent position changes across the organisation. */
  @Get('promotions')
  @RequireAny(P.PROMOTIONS_MANAGE)
  promotions() {
    return this.svc.recentPromotions();
  }

  @Get('directory')
  directory(@Query(zp(directoryQuery)) q: z.infer<typeof directoryQuery>) {
    return this.svc.directory(q);
  }

  @Get('directory/org-chart')
  orgChart() {
    return this.svc.orgChart();
  }

  @Get('headcount')
  @RequireAny(P.HEADCOUNT_READ)
  headcount() {
    return this.svc.headcount();
  }
}
