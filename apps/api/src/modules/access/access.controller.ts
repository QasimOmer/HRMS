import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Patch, Query } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS as P,
  ROLES,
  ROLE_LABELS,
  adminSetPasswordSchema,
  canAssignRole,
  pagination,
  rolePermissionsSchema,
  setUserRolesSchema,
  setUserStatusSchema,
  type Role,
} from '@hrms/shared';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { currentUser } from '../../common/context';
import { hashPassword } from '../../common/crypto';
import { Audit, RequireAny } from '../../common/decorators';
import { badRequest, forbidden } from '../../common/errors';
import { like, offset, one, page } from '../../common/util';
import { zp } from '../../common/zod.pipe';
import { DbService } from '../../db/db.service';
import { auditLogs, employees, refreshTokens, rolePermissions, userRoles, users } from '../../db/schema';
import { AccessService } from '../auth/access.service';
import { AuthService } from '../auth/auth.service';

const auditQuery = pagination.extend({
  action: z.string().max(80).optional(),
  actorUserId: z.uuid().optional(),
  entityType: z.string().max(60).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** A1 – user access management (HR, Operations, Super Admin). */
@Controller('access')
export class AccessController {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  private async targetUser(id: string) {
    const tx = this.db.tx;
    const u = one(await tx.select().from(users).where(eq(users.id, id)), 'User');
    const roles = (await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, id))).map((r) => r.role as Role);
    // You may only manage someone whose every role you are allowed to grant.
    const actor = currentUser();
    if (roles.some((r) => !canAssignRole(actor.roles, r))) throw forbidden('You cannot manage this account');
    this.access.forget(id); // role / status / password changes apply on the next request
    return { ...u, roles };
  }

  private async revokeSessions(userId: string) {
    const tx = this.db.tx;
    await tx.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, userId));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  @Get('users')
  @RequireAny(P.USERS_MANAGE_ACCESS)
  async listUsers(@Query(zp(pagination)) q: z.infer<typeof pagination>) {
    const tx = this.db.tx;
    const where = q.search ? or(ilike(users.email, like(q.search)), ilike(employees.fullName, like(q.search))) : undefined;
    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        lockedUntil: users.lockedUntil,
        employeeId: users.employeeId,
        fullName: employees.fullName,
        employeeCode: employees.employeeCode,
        designation: employees.designation,
      })
      .from(users)
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(where)
      .orderBy(employees.fullName)
      .limit(q.pageSize)
      .offset(offset(q));
    const [{ n }] = (await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .leftJoin(employees, eq(employees.id, users.employeeId))
      .where(where)) as [{ n: number }];
    const roleRows = rows.length
      ? await tx.select().from(userRoles).where(inArray(userRoles.userId, rows.map((r) => r.id)))
      : [];
    const items = rows.map((r) => ({ ...r, roles: roleRows.filter((x) => x.userId === r.id).map((x) => x.role) }));
    return page(items, n, q);
  }

  @Put('users/:id/roles')
  @RequireAny(P.USERS_MANAGE_ACCESS)
  @Audit('access.roles_changed', 'user')
  async setRoles(@Param('id', ParseUUIDPipe) id: string, @Body(zp(setUserRolesSchema)) body: z.infer<typeof setUserRolesSchema>) {
    const tx = this.db.tx;
    const actor = currentUser();
    const target = await this.targetUser(id);
    const next = [...new Set<Role>([...body.roles, 'EMPLOYEE'])];
    const changed = [...next.filter((r) => !target.roles.includes(r)), ...target.roles.filter((r) => !next.includes(r))];
    if (changed.some((r) => !canAssignRole(actor.roles, r))) throw forbidden('You cannot grant or revoke that role');
    if (target.roles.includes('SUPER_ADMIN') && !next.includes('SUPER_ADMIN')) {
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(userRoles).where(eq(userRoles.role, 'SUPER_ADMIN'))) as [{ n: number }];
      if (n <= 1) throw badRequest('There must be at least one Company Admin');
    }
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    await tx.insert(userRoles).values(next.map((role) => ({ tenantId: actor.tenantId, userId: id, role })));
    return { id, roles: next };
  }

  @Patch('users/:id/status')
  @RequireAny(P.USERS_MANAGE_ACCESS)
  @Audit('access.status_changed', 'user')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body(zp(setUserStatusSchema)) body: z.infer<typeof setUserStatusSchema>) {
    if (id === currentUser().userId) throw badRequest('You cannot change your own access');
    await this.targetUser(id);
    await this.db.tx.update(users).set({ status: body.status, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, id));
    if (body.status === 'DISABLED') await this.revokeSessions(id);
    return { id, status: body.status };
  }

  /** Operations/HR, or anyone who can edit employees: email a password reset link (A1). */
  @Post('users/:id/reset-link')
  @RequireAny(P.USERS_MANAGE_ACCESS, P.EMPLOYEES_MANAGE)
  @Audit('access.reset_link_sent', 'user')
  async resetLink(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.targetUser(id);
    await this.auth.sendTokenEmail(this.db.tx, t.tenantId, t, t.passwordHash ? 'PASSWORD_RESET' : 'INVITE', currentUser().userId);
    return { id, sent: true };
  }

  /** Operations/HR, or anyone who can edit employees: set a password directly (A1). */
  @Post('users/:id/password')
  @RequireAny(P.USERS_MANAGE_ACCESS, P.EMPLOYEES_MANAGE)
  @Audit('access.password_set', 'user')
  async setPassword(@Param('id', ParseUUIDPipe) id: string, @Body(zp(adminSetPasswordSchema)) body: z.infer<typeof adminSetPasswordSchema>) {
    if (id === currentUser().userId) throw badRequest('Use "Change password" for your own account');
    const t = await this.targetUser(id);
    await this.db.tx
      .update(users)
      .set({
        passwordHash: await hashPassword(body.password),
        mustChangePassword: body.mustChange,
        passwordChangedAt: new Date(),
        status: t.status === 'INVITED' ? 'ACTIVE' : t.status,
        failedLoginCount: 0,
        lockedUntil: null,
      })
      .where(eq(users.id, id));
    await this.revokeSessions(id);
    return { id, ok: true };
  }

  @Get('roles')
  @RequireAny(P.ROLES_MANAGE, P.USERS_MANAGE_ACCESS)
  async roles() {
    const rows = await this.db.tx.select().from(rolePermissions);
    return {
      permissions: ALL_PERMISSIONS,
      roles: ROLES.map((role) => ({
        role,
        label: ROLE_LABELS[role],
        editable: role !== 'SUPER_ADMIN',
        permissions: rows.filter((r) => r.role === role).map((r) => r.permission),
        defaults: DEFAULT_ROLE_PERMISSIONS[role],
      })),
    };
  }

  @Put('roles/:role')
  @RequireAny(P.ROLES_MANAGE)
  @Audit('access.role_permissions_changed', 'role')
  async setRolePermissions(@Param('role') role: string, @Body(zp(rolePermissionsSchema)) body: z.infer<typeof rolePermissionsSchema>) {
    if (!ROLES.includes(role as Role)) throw badRequest('Unknown role');
    if (role === 'SUPER_ADMIN') throw badRequest('The Company Admin always has full access');
    const actor = currentUser();
    this.access.forgetAll();
    // Nobody can grant a permission they don't hold themselves (prevents privilege escalation).
    const missing = body.permissions.filter((p) => !actor.permissions.has(p as never));
    if (missing.length) throw forbidden(`You cannot grant permissions you don't have: ${missing.join(', ')}`);
    const tx = this.db.tx;
    await tx.delete(rolePermissions).where(eq(rolePermissions.role, role));
    if (body.permissions.length) {
      await tx.insert(rolePermissions).values(body.permissions.map((permission) => ({ tenantId: actor.tenantId, role, permission })));
    }
    return { role, permissions: body.permissions };
  }

  /** F5 – audit trail browser. */
  @Get('audit')
  @RequireAny(P.AUDIT_READ)
  async audit(@Query(zp(auditQuery)) q: z.infer<typeof auditQuery>) {
    const tx = this.db.tx;
    const conds: SQL[] = [];
    if (q.action) conds.push(ilike(auditLogs.action, like(q.action)));
    if (q.actorUserId) conds.push(eq(auditLogs.actorUserId, q.actorUserId));
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.from) conds.push(gte(auditLogs.createdAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) conds.push(lte(auditLogs.createdAt, new Date(`${q.to}T23:59:59Z`)));
    if (q.search) conds.push(or(ilike(auditLogs.actorLabel, like(q.search)), ilike(auditLogs.path, like(q.search)))!);
    const where = conds.length ? and(...conds) : undefined;
    const rows = await tx.select({ a: auditLogs, email: users.email }).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where).orderBy(desc(auditLogs.id)).limit(q.pageSize).offset(offset(q));
    // Older entries (e.g. sign-outs) stored only the user id: show their email instead of "system".
    const items = rows.map((r) => ({ ...r.a, actorLabel: r.a.actorLabel ?? r.email ?? null }));
    const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(where)) as [{ n: number }];
    return page(items, n, q);
  }
}
