import { Injectable } from '@nestjs/common';
import type { Permission } from '@hrms/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { appUrlFor } from '../common/app-url';
import { als } from '../common/context';
import { DbService } from '../db/db.service';
import { employees, notifications, rolePermissions, tenants, userRoles, users } from '../db/schema';
import { MailService } from './mail.service';

export interface NotifyInput {
  type: string;
  title: string;
  body?: string;
  link?: string;
  /** Also send an email (e.g. leave cancellation → HR, C3/G4). */
  email?: boolean;
}

/** G4 – in-app notifications (+ optional email). Runs in the caller's tenant transaction. */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DbService,
    private readonly mail: MailService,
  ) {}

  async notifyUsers(userIds: (string | null | undefined)[], n: NotifyInput) {
    const ids = [...new Set(userIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    const tx = this.db.tx;
    const tenantId = als.getStore()?.tenantId;
    if (!tenantId) throw new Error('notifyUsers called outside a tenant context');
    await tx.insert(notifications).values(
      ids.map((userId) => ({ tenantId, userId, type: n.type, title: n.title, body: n.body, link: n.link })),
    );
    if (n.email) {
      const rows = await tx.select({ email: users.email }).from(users).where(inArray(users.id, ids));
      const [tenant] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
      const app = appUrlFor(tenant?.slug);
      for (const r of rows) {
        await this.mail.send({
          to: r.email,
          subject: n.title,
          text: `${n.body ?? n.title}\n\n${n.link ? `Open: ${app}${n.link}` : ''}`,
        });
      }
    }
  }

  async notifyEmployees(employeeIds: (string | null | undefined)[], n: NotifyInput) {
    const ids = [...new Set(employeeIds.filter((x): x is string => !!x))];
    if (!ids.length) return;
    const rows = await this.db.tx
      .select({ userId: employees.userId })
      .from(employees)
      .where(and(inArray(employees.id, ids), isNotNull(employees.userId)));
    await this.notifyUsers(rows.map((r) => r.userId), n);
  }

  /** Active users in this tenant holding a permission (e.g. all HR approvers). */
  async usersWithPermission(permission: Permission): Promise<string[]> {
    const rows = await this.db.tx
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(
        rolePermissions,
        and(eq(rolePermissions.role, userRoles.role), eq(rolePermissions.tenantId, users.tenantId)),
      )
      .where(and(eq(rolePermissions.permission, permission), eq(users.status, 'ACTIVE')));
    return rows.map((r) => r.id);
  }

  async notifyPermission(permission: Permission, n: NotifyInput, exceptUserId?: string) {
    const ids = (await this.usersWithPermission(permission)).filter((id) => id !== exceptUserId);
    await this.notifyUsers(ids, n);
  }
}
