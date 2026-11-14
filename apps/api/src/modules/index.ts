import { Module } from '@nestjs/common';
import { AccessController } from './access/access.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { PlatformController } from './platform/platform.controller';
import { BrandingController } from './platform/branding.controller';
import { PlatformSettingsService } from './platform/platform-settings.service';
import { BillingController } from './platform/billing.controller';
import { BillingService } from './platform/billing.service';
import { BiometricController } from './attendance/biometric.controller';
import { AttendanceService } from './attendance/attendance.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CommunityController } from './community/community.controller';
import { NotificationsController } from './community/notifications.controller';
import { ComplianceController } from './compliance/compliance.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { SchedulerService } from './dashboard/scheduler.service';
import { DocumentsController } from './employees/documents.controller';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { ResignationsController } from './employees/resignations.controller';
import { LeaveController } from './leave/leave.controller';
import { LeaveService } from './leave/leave.service';
import { OrgController } from './org/org.controller';
import { PayrollController } from './payroll/payroll.controller';
import { PayrollService } from './payroll/payroll.service';
import { PerformanceController } from './performance/performance.controller';
import { SurveysController } from './performance/surveys.controller';

/** Part A – access & roles */
@Module({ controllers: [AuthController, AccessController, PlatformController, BrandingController, BillingController], providers: [AuthService, PlatformSettingsService, BillingService], exports: [AuthService] })
export class AuthModule {}

/** Part B – employee management */
@Module({
  imports: [AuthModule],
  controllers: [OrgController, EmployeesController, DocumentsController, ResignationsController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}

/** Part C – workforce scheduling & leave */
@Module({ controllers: [AttendanceController, BiometricController, LeaveController], providers: [AttendanceService, LeaveService], exports: [AttendanceService, LeaveService] })
export class WorkforceModule {}

/** Part D – payroll */
@Module({ imports: [WorkforceModule], controllers: [PayrollController], providers: [PayrollService] })
export class PayrollModule {}

/** Part E – performance */
@Module({ controllers: [PerformanceController, SurveysController] })
export class PerformanceModule {}

/** Part F – compliance & policies */
@Module({ controllers: [ComplianceController] })
export class ComplianceModule {}

/** Part G – community & engagement */
@Module({ controllers: [CommunityController, NotificationsController] })
export class CommunityModule {}

/** A2 dashboards, H1 approvals inbox, scheduled jobs */
@Module({ imports: [WorkforceModule, EmployeesModule], controllers: [DashboardController], providers: [SchedulerService] })
export class DashboardModule {}

export const FEATURE_MODULES = [
  AuthModule,
  EmployeesModule,
  WorkforceModule,
  PayrollModule,
  PerformanceModule,
  ComplianceModule,
  CommunityModule,
  DashboardModule,
];
