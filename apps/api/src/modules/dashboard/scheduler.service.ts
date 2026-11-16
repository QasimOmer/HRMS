import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { config } from '../../config';
import { addDays, todayIn } from '../../common/tz';
import { AuditService } from '../../core/audit.service';
import { JobsService } from '../../core/jobs.service';
import { NotificationsService } from '../../core/notifications.service';
import { DbService } from '../../db/db.service';
import { departments, employees, posts, tenants, users } from '../../db/schema';
import { DEFAULT_BIRTHDAY_BODY, DEFAULT_BIRTHDAY_TITLE, renderBirthdayTemplate } from '@hrms/shared';
import { AttendanceService } from '../attendance/attendance.service';
import { EmployeesService } from '../employees/employees.service';

/**
 * Enqueues one "daily" job per tenant per local day (dedupe key makes it safe across instances):
 *  - finalise yesterday's attendance (absences, overtime records),
 *  - birthday posts + notifications (G3),
 *  - disable accounts after the last working day (B4).
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Scheduler');
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: DbService,
    private readonly jobs: JobsService,
    private readonly attendance: AttendanceService,
    private readonly employeesSvc: EmployeesService,
    private readonly notify: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap() {
    this.jobs.register('daily', (p) => this.runDaily(p.tenantId as string, p.date as string));
    if (!config().ENABLE_SCHEDULER || process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.tick(), 5_000);
    this.timer = setInterval(() => void this.tick(), 10 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const all = await this.db.root.select({ id: tenants.id, tz: tenants.timezone }).from(tenants).where(eq(tenants.status, 'ACTIVE'));
      for (const t of all) {
        const date = todayIn(t.tz);
        await this.jobs.enqueue('daily', { tenantId: t.id, date }, { dedupeKey: `daily:${t.id}:${date}` });
      }
    } catch (err) {
      this.logger.error(`Scheduler tick failed: ${(err as Error).message}`);
    }
  }

  async runDaily(tenantId: string, date: string) {
    await this.db.inTenant(tenantId, async (tx) => {
      const yesterday = addDays(date, -1);

      // 1) Finalise yesterday's attendance for everyone active.
      const active = await tx.select({ id: employees.id }).from(employees).where(eq(employees.employmentStatus, 'ACTIVE'));
      for (const e of active) await this.attendance.recompute(e.id, yesterday, yesterday);

      // 2) Birthdays (G3) – part of the Community module.
      const [plan] = await tx.select({ modules: tenants.modules, name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
      const mmdd = date.slice(5);
      const bdays = !plan?.modules.includes('COMMUNITY') ? [] : await tx
        .select({ id: employees.id, fullName: employees.fullName, designation: employees.designation, department: departments.name })
        .from(employees)
        .innerJoin(departments, eq(departments.id, employees.departmentId))
        .where(and(eq(employees.employmentStatus, 'ACTIVE'), isNotNull(employees.dateOfBirth), sql`to_char(${employees.dateOfBirth}, 'MM-DD') = ${mmdd}`));
      for (const b of bdays) {
        const [exists] = await tx
          .select({ id: posts.id })
          .from(posts)
          .where(and(eq(posts.type, 'BIRTHDAY'), eq(posts.subjectEmployeeId, b.id), sql`to_char(${posts.createdAt}, 'YYYY') = ${date.slice(0, 4)}`));
        if (exists) continue;
        // The Company Admin's template (Settings → Community), or the default wording.
        const vars = { name: b.fullName, department: b.department, designation: b.designation, company: plan?.name };
        const title = renderBirthdayTemplate(plan?.settings.birthdayPostTitle || DEFAULT_BIRTHDAY_TITLE, vars);
        const body = renderBirthdayTemplate(plan?.settings.birthdayPostBody || DEFAULT_BIRTHDAY_BODY, vars);
        await tx.insert(posts).values({ tenantId, type: 'BIRTHDAY', title, body, subjectEmployeeId: b.id });
        const everyone = await tx.select({ id: users.id }).from(users).where(eq(users.status, 'ACTIVE'));
        await this.notify.notifyUsers(everyone.map((u) => u.id), { type: 'birthday', title: `It's ${b.fullName}'s birthday today 🎉`, link: '/community' });
      }

      // 3) Disable accounts after the last working day.
      const exited = await tx
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .innerJoin(users, eq(users.id, employees.userId))
        .where(and(isNotNull(employees.exitDate), lt(employees.exitDate, date), sql`${employees.employmentStatus} in ('RESIGNED','TERMINATED')`, sql`${users.status} <> 'DISABLED'`));
      for (const e of exited) if (e.userId) await this.employeesSvc.disableUser(e.userId);

      await this.audit.log(tx, { tenantId, action: 'system.daily_job', actorLabel: 'system', metadata: { date, finalised: active.length, birthdays: bdays.length, disabled: exited.length } });
    });
  }
}
