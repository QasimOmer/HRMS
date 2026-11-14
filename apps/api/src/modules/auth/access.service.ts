import { Injectable } from '@nestjs/common';
import { ALL_PERMISSIONS, permissionAllowed, type Permission, type Role } from '@hrms/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthUser } from '../../common/context';
import { DbService } from '../../db/db.service';
import { rolePermissions, teams, tenants, userRoles, users } from '../../db/schema';
import { sessionIdleMinutes } from './tokens';

/** How long a resolved user (roles, permissions, status) is reused before re-reading the database. */
const USER_CACHE_MS = 10_000;
/** How often a session's inactivity window is re-checked (and extended) in the database. */
const SESSION_CHECK_MS = 30_000;
const MAX_CACHE = 5_000;

/** Resolves a user's effective roles, permissions and data scope. */
@Injectable()
export class AccessService {
  constructor(private readonly db: DbService) {}

  /**
   * Every API request authenticates through here, so results are kept in memory for a few seconds
   * instead of running ~6 queries per request. Disabling a user, changing roles or a password takes
   * effect within USER_CACHE_MS; `forget()` makes it immediate on this server.
   */
  private users = new Map<string, { user: AuthUser; at: number }>();
  private sessions = new Map<string, number>();

  forget(userId: string) {
    for (const k of this.users.keys()) if (k.includes(`:${userId}:`)) this.users.delete(k);
  }

  /** After a role's permissions change, everyone's cached permissions are stale. */
  forgetAll() {
    this.users.clear();
  }

  async load(tenantId: string, userId: string, tokenVersion?: number, session?: { sid: string; active: boolean }): Promise<AuthUser | null> {
    const now = Date.now();
    const key = `${tenantId}:${userId}:${tokenVersion ?? '-'}`;
    let user = this.users.get(key);
    const sessionFresh = !session || now - (this.sessions.get(session.sid) ?? 0) < SESSION_CHECK_MS;
    if (user && now - user.at < USER_CACHE_MS && sessionFresh) return user.user;

    const fresh = await this.loadFresh(tenantId, userId, tokenVersion, sessionFresh ? undefined : session);
    if (!fresh) {
      this.users.delete(key);
      if (session) this.sessions.delete(session.sid);
      return null;
    }
    if (this.users.size > MAX_CACHE) this.users.clear();
    if (this.sessions.size > MAX_CACHE) this.sessions.clear();
    this.users.set(key, { user: fresh, at: now });
    if (session && !sessionFresh) this.sessions.set(session.sid, now);
    return fresh;
  }

  private async loadFresh(tenantId: string, userId: string, tokenVersion?: number, session?: { sid: string; active: boolean }): Promise<AuthUser | null> {
    return this.db.inTenant(tenantId, async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u || u.status !== 'ACTIVE') return null;
      if (tokenVersion !== undefined && u.tokenVersion !== tokenVersion) return null;

      const [tenant] = await tx.select({ settings: tenants.settings, modules: tenants.modules, status: tenants.status, billingStatus: tenants.billingStatus, isDemo: tenants.isDemo }).from(tenants).where(eq(tenants.id, tenantId));
      if (!tenant || tenant.status !== 'ACTIVE') return null; // suspended companies are locked out at once

      if (session) {
        // SEC-03: end the session after the configured inactivity; real user activity extends it
        // (written at most once a minute to keep requests cheap).
        const idle = sessionIdleMinutes(tenant.settings);
        const res = await tx.execute(sql`
          with s as (
            select id, last_activity_at from refresh_tokens
            where family_id = ${session.sid} and user_id = ${userId} and revoked_at is null
            order by created_at desc limit 1
          ), touched as (
            update refresh_tokens r set last_activity_at = now() from s
            where r.id = s.id and ${session.active} and s.last_activity_at < now() - interval '1 minute'
              and s.last_activity_at > now() - make_interval(mins => ${idle})
            returning r.id
          )
          select (select last_activity_at > now() - make_interval(mins => ${idle}) from s) as ok`);
        if ((res.rows[0] as { ok: boolean | null } | undefined)?.ok !== true) return null;
      }

      const roleRows = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
      const roles = roleRows.map((r) => r.role as Role);
      const permRows = roles.length
        ? await tx
            .select({ permission: rolePermissions.permission })
            .from(rolePermissions)
            .where(and(eq(rolePermissions.tenantId, tenantId), inArray(rolePermissions.role, roles)))
        : [];

      const ledTeamIds =
        u.employeeId && roles.includes('TEAM_LEAD')
          ? (
              await tx
                .select({ id: teams.id })
                .from(teams)
                .where(and(eq(teams.leadEmployeeId, u.employeeId), eq(teams.isActive, true)))
            ).map((t) => t.id)
          : [];

      return {
        userId: u.id,
        tenantId,
        email: u.email,
        employeeId: u.employeeId,
        roles,
        // Super Admin always holds every permission (including ones added later); everyone is limited to the
        // modules the company pays for.
        permissions: new Set(
          (roles.includes('SUPER_ADMIN') ? ALL_PERMISSIONS : permRows.map((p) => p.permission as Permission)).filter((p) => permissionAllowed(p, tenant.modules)),
        ),
        modules: tenant.modules,
        billingStatus: tenant.billingStatus,
        isDemo: tenant.isDemo,
        ledTeamIds,
        canPost: u.canPost,
      };
    });
  }
}
