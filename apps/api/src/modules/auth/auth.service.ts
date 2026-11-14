import { Injectable, UnauthorizedException } from '@nestjs/common';
import { suggestEmailDomain, type CreateCompanyInput, type LoginInput } from '@hrms/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { config } from '../../config';
import { als } from '../../common/context';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../common/crypto';
import { badRequest, conflict } from '../../common/errors';
import { emailInUse } from '../../common/util';
import { AuditService } from '../../core/audit.service';
import { MailService } from '../../core/mail.service';
import { PlatformSettingsService } from '../platform/platform-settings.service';
import { DbService, type Tx } from '../../db/db.service';
import {
  departments,
  employeePositions,
  employees,
  platformPlans,
  userDirectory,
  guidelineAcceptances,
  guidelineVersions,
  levels,
  refreshTokens,
  tenants,
  userRoles,
  userTokens,
  users,
} from '../../db/schema';
import { AccessService } from './access.service';
import { nextEmployeeCode, provisionTenant } from './provisioning';
import { lockMinutesFor, waitText } from './lockout';
import { REFRESH_TTL_SEC, sessionIdleMinutes, signAccessToken } from './tokens';

const INVITE_TTL_H = 72;
const RESET_TTL_MIN = 60;

export interface SessionTokens {
  access: string;
  refresh: string;
}

const INVALID = () => new UnauthorizedException({ message: 'Incorrect workspace, email or password', code: 'INVALID_CREDENTIALS' });

/** Token format "<tenantId>.<secret>" lets us set the RLS tenant before looking the token up. */
function splitToken(raw: string | undefined): { tenantId: string; secret: string } | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot !== 36) return null;
  const tenantId = raw.slice(0, 36);
  const secret = raw.slice(37);
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || secret.length < 20) return null;
  return { tenantId, secret };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly platform: PlatformSettingsService,
  ) {}

  private async issue(tx: Tx, tenantId: string, userId: string, tokenVersion: number, familyId: string = randomUUID(), lastActivityAt: Date = new Date()): Promise<SessionTokens & { id: string }> {
    const secret = randomToken(32);
    const store = als.getStore();
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        tenantId,
        userId,
        familyId,
        tokenHash: sha256(secret),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
        lastActivityAt,
        ip: store?.ip,
        userAgent: store?.userAgent?.slice(0, 300),
      })
      .returning({ id: refreshTokens.id });
    // `sid` lets every request check and extend this session's inactivity window (SEC-03).
    const access = await signAccessToken({ sub: userId, tid: tenantId, ver: tokenVersion, sid: familyId });
    return { id: row!.id, access, refresh: `${tenantId}.${secret}` };
  }

  /* ---------------- New client company (platform owners only) ---------------- */

  /**
   * Creates a company (tenant) with its default structure and first Super Admin. There is no public sign-up:
   * this is called only from the platform console. Without a password the Super Admin is emailed an invite.
   */
  /** Signs a known user in without a password (right after website sign-up, or the read-only demo). */
  async sessionFor(tenantId: string, userId: string): Promise<SessionTokens> {
    return this.db.inTenant(tenantId, async (tx) => {
      const [u] = await tx.select({ v: users.tokenVersion }).from(users).where(eq(users.id, userId));
      if (!u) throw badRequest('Account not found');
      const t = await this.issue(tx, tenantId, userId, u.v);
      return { access: t.access, refresh: t.refresh };
    });
  }

  async createCompany(input: CreateCompanyInput, createdBy: string): Promise<{ tenantId: string; userId: string; invited: boolean }> {
    const [existing] = await this.db.root.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.workspace)).limit(1);
    if (existing) throw conflict('That workspace name is taken', 'WORKSPACE_TAKEN');

    if (await emailInUse(this.db, input.email)) throw conflict('This email is already used by another account. Use a different email for the Company Admin.', 'EMAIL_TAKEN');
    const plan = input.planId ? (await this.db.root.select().from(platformPlans).where(eq(platformPlans.id, input.planId)))[0] : undefined;
    if (input.planId && !plan) throw badRequest('Choose a valid plan', 'PLAN_NOT_FOUND');

    // Company email domain: the one given, or one made from the company name (then the workspace) that is free.
    const domainTaken = async (d: string) => (await this.db.root.select({ id: tenants.id }).from(tenants).where(eq(tenants.emailDomain, d)).limit(1)).length > 0;
    let domain = input.emailDomain ?? suggestEmailDomain(input.companyName);
    if (await domainTaken(domain)) {
      if (input.emailDomain) throw conflict(`The email domain ${domain} is already used by another company`, 'DOMAIN_TAKEN');
      domain = suggestEmailDomain(input.workspace);
      if (await domainTaken(domain)) domain = `${input.workspace.replace(/[^a-z0-9]/g, '')}${Date.now().toString(36).slice(-4)}.com`;
    }

    return this.db.root.transaction(async (tx) => {
      const [tenant] = await tx
        .insert(tenants)
        .values({
          emailDomain: domain,
          name: input.companyName,
          slug: input.workspace,
          timezone: input.timezone,
          currency: input.currency,
          ...(plan ? { planId: plan.id, modules: plan.modules, maxEmployees: plan.maxEmployees } : {}),
        })
        .returning();
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant!.id}, true)`);

      const [user] = await tx
        .insert(users)
        .values({
          tenantId: tenant!.id,
          email: input.email,
          passwordHash: input.password ? await hashPassword(input.password) : null,
          status: input.password ? 'ACTIVE' : 'INVITED',
          passwordChangedAt: input.password ? new Date() : null,
          mustChangePassword: !!input.password && input.mustChangePassword,
          canPost: true,
        })
        .returning();
      const { management } = await provisionTenant(tx, tenant!.id, user!.id);
      const [topLevel] = await tx
        .select()
        .from(levels)
        .where(and(eq(levels.departmentId, management.id), eq(levels.code, 'L6')))
        .limit(1);
      const today = new Date().toISOString().slice(0, 10);
      const [emp] = await tx
        .insert(employees)
        .values({
          tenantId: tenant!.id,
          employeeCode: await nextEmployeeCode(tx, tenant!.id),
          userId: user!.id,
          fullName: input.adminName,
          email: input.email,
          departmentId: management.id,
          levelId: topLevel!.id,
          designation: 'Administrator',
          hierarchyTier: 'DIRECTOR',
          joiningDate: today,
          basicSalary: topLevel!.defaultSalary,
          onboardingCompletedAt: new Date(),
        })
        .returning();
      await tx.insert(employeePositions).values({
        tenantId: tenant!.id,
        employeeId: emp!.id,
        departmentId: management.id,
        levelId: topLevel!.id,
        designation: 'Administrator',
        salary: topLevel!.defaultSalary,
        startDate: today,
        changeType: 'JOINED',
      });
      await tx.update(users).set({ employeeId: emp!.id }).where(eq(users.id, user!.id));
      await tx.update(departments).set({ headEmployeeId: emp!.id }).where(eq(departments.id, management.id));
      await tx.insert(userRoles).values([
        { tenantId: tenant!.id, userId: user!.id, role: 'SUPER_ADMIN' },
        { tenantId: tenant!.id, userId: user!.id, role: 'EMPLOYEE' },
      ]);
      await this.audit.log(tx, { tenantId: tenant!.id, action: 'tenant.created', actorLabel: `platform:${createdBy}`, entityType: 'tenant', entityId: tenant!.id, metadata: { superAdmin: input.email, invited: !input.password } });
      await this.sendCompanyWelcome(tx, tenant!.id, { id: user!.id, email: input.email, name: input.adminName }, !input.password);
      return { tenantId: tenant!.id, userId: user!.id, invited: !input.password };
    });
  }

  /* ---------------- Login ---------------- */

  /** Active companies an email belongs to (one indexed lookup in the platform-wide directory). */
  private async workspacesFor(email: string) {
    return this.db.root
      .select({ slug: tenants.slug, name: tenants.name })
      .from(userDirectory)
      .innerJoin(tenants, eq(tenants.id, userDirectory.tenantId))
      .where(and(eq(userDirectory.email, email.toLowerCase()), eq(tenants.status, 'ACTIVE')))
      .limit(20);
  }

  /**
   * Email + password sign-in. The company is found from the email; when the same email is used in several
   * companies and the password matches more than one, the person picks the workspace (never revealed before
   * the password is proven).
   */
  async loginByEmail(input: LoginInput): Promise<SessionTokens> {
    if (input.workspace) return this.login({ ...input, workspace: input.workspace });
    const spaces = await this.workspacesFor(input.email);
    if (spaces.length === 0) {
      await verifyPassword(null, input.password); // same timing as a real account
      throw INVALID();
    }
    if (spaces.length === 1) return this.login({ ...input, workspace: spaces[0]!.slug });
    const matches: { slug: string; name: string }[] = [];
    for (const s of spaces) {
      const ok = await this.db.inTenant(
        (await this.db.root.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, s.slug)))[0]!.id,
        async (tx) => {
          const [u] = await tx.select({ hash: users.passwordHash, status: users.status, locked: users.lockedUntil }).from(users).where(eq(users.email, input.email)).limit(1);
          return !!u && u.status === 'ACTIVE' && !(u.locked && u.locked > new Date()) && (await verifyPassword(u.hash, input.password));
        },
      );
      if (ok) matches.push(s);
    }
    if (matches.length === 1) return this.login({ ...input, workspace: matches[0]!.slug });
    if (matches.length > 1) throw conflict('This email is used in more than one company. Choose the workspace to open.', 'CHOOSE_WORKSPACE', { workspaces: matches });
    // Wrong password: count the failed attempt (and any lockout) on every account with this email.
    for (const s of spaces) await this.login({ ...input, workspace: s.slug }).catch(() => undefined);
    throw INVALID();
  }

  async login(input: LoginInput & { workspace: string }): Promise<SessionTokens> {
    const [tenant] = await this.db.root.select().from(tenants).where(eq(tenants.slug, input.workspace)).limit(1);
    if (!tenant || tenant.status !== 'ACTIVE') {
      await verifyPassword(null, input.password);
      throw INVALID();
    }
    const outcome = await this.db.inTenant(tenant.id, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.email, input.email)).limit(1);
      const ok = await verifyPassword(user?.passwordHash, input.password);
      if (!user) return { error: INVALID() };

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await this.audit.log(tx, { tenantId: tenant.id, action: 'auth.login_locked', actorUserId: user.id, actorLabel: user.email });
        return { error: new UnauthorizedException({ message: `Account temporarily locked. Try again in ${waitText(user.lockedUntil)} or reset your password.`, code: 'LOCKED' }) };
      }
      if (!ok) {
        const failed = user.failedLoginCount + 1;
        const lockMin = lockMinutesFor(failed);
        const lockedUntil = lockMin ? new Date(Date.now() + lockMin * 60_000) : null;
        await tx.update(users).set({ failedLoginCount: failed, lockedUntil }).where(eq(users.id, user.id));
        await this.audit.log(tx, { tenantId: tenant.id, action: 'auth.login_failed', actorUserId: user.id, actorLabel: user.email, metadata: { failed, lockMinutes: lockMin } });
        if (lockedUntil) return { error: new UnauthorizedException({ message: `Too many failed attempts. Your account is locked for ${waitText(lockedUntil)}. You can also reset your password.`, code: 'LOCKED' }) };
        return { error: INVALID() };
      }
      if (user.status !== 'ACTIVE') return { error: new UnauthorizedException({ message: 'This account is disabled. Contact HR.', code: 'DISABLED' }) };

      await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await this.audit.log(tx, { tenantId: tenant.id, action: 'auth.login', actorUserId: user.id, actorLabel: user.email });
      return { tokens: await this.issue(tx, tenant.id, user.id, user.tokenVersion) };
    });
    // Failed-attempt counters must be committed, so errors are thrown after the transaction.
    if ('error' in outcome) throw outcome.error;
    return outcome.tokens;
  }

  /* ---------------- Refresh (rotation + reuse detection) ---------------- */

  async refresh(raw: string | undefined): Promise<SessionTokens> {
    const parts = splitToken(raw);
    if (!parts) throw new UnauthorizedException({ message: 'Session expired', code: 'UNAUTHENTICATED' });
    const outcome = await this.db.inTenant(parts.tenantId, async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(parts.secret))).limit(1);
      if (!row) return null;
      if (row.revokedAt) {
        // A rotated token was presented again → likely theft. Kill the whole family.
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        await this.audit.log(tx, { tenantId: parts.tenantId, action: 'auth.refresh_reuse_detected', actorUserId: row.userId });
        return null;
      }
      if (row.expiresAt < new Date()) return null;
      // SEC-03: an idle session cannot be revived by refreshing.
      const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, parts.tenantId));
      const idleMin = sessionIdleMinutes(t?.settings);
      if (row.lastActivityAt.getTime() < Date.now() - idleMin * 60_000) {
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
        await this.audit.log(tx, { tenantId: parts.tenantId, action: 'auth.session_idle_timeout', actorUserId: row.userId, metadata: { idleMinutes: idleMin } });
        return null;
      }
      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || user.status !== 'ACTIVE') return null;
      const next = await this.issue(tx, parts.tenantId, user.id, user.tokenVersion, row.familyId, row.lastActivityAt);
      await tx.update(refreshTokens).set({ revokedAt: new Date(), replacedById: next.id }).where(eq(refreshTokens.id, row.id));
      return next;
    });
    if (!outcome) throw new UnauthorizedException({ message: 'Session expired', code: 'UNAUTHENTICATED' });
    return outcome;
  }

  async logout(raw: string | undefined) {
    const parts = splitToken(raw);
    if (!parts) return;
    await this.db.inTenant(parts.tenantId, async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(parts.secret))).limit(1);
      if (row) {
        await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, row.familyId));
        await this.audit.log(tx, { tenantId: parts.tenantId, action: 'auth.logout', actorUserId: row.userId });
      }
    });
  }

  /* ---------------- Invites & password reset ---------------- */

  /** Creates an invite / reset token in the current tenant tx and emails the link. */
  async sendTokenEmail(tx: Tx, tenantId: string, user: { id: string; email: string }, purpose: 'INVITE' | 'PASSWORD_RESET', createdByUserId?: string) {
    const secret = randomToken(32);
    const ttl = purpose === 'INVITE' ? INVITE_TTL_H * 3600_000 : RESET_TTL_MIN * 60_000;
    // Invalidate older outstanding tokens of the same purpose.
    await tx.update(userTokens).set({ usedAt: new Date() }).where(and(eq(userTokens.userId, user.id), eq(userTokens.purpose, purpose), isNull(userTokens.usedAt)));
    await tx.insert(userTokens).values({ tenantId, userId: user.id, purpose, tokenHash: sha256(secret), expiresAt: new Date(Date.now() + ttl), createdByUserId });
    const [tenant] = await tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    const link = `${config().APP_URL}/reset-password?token=${encodeURIComponent(`${tenantId}.${secret}`)}${purpose === 'INVITE' ? '&invite=1' : ''}`;
    await this.mail.send({
      to: user.email,
      subject: purpose === 'INVITE' ? `You're invited to ${tenant?.name} on ${await this.platform.name()}` : `Reset your ${await this.platform.name()} password`,
      text:
        purpose === 'INVITE'
          ? `You've been added to ${tenant?.name}'s HR portal.\n\nWorkspace: ${tenant?.slug}\nSet your password (link valid for ${INVITE_TTL_H} hours):\n${link}`
          : `A password reset was requested for your account in workspace "${tenant?.slug}".\n\nReset it here (valid for ${RESET_TTL_MIN} minutes):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }

  /**
   * Welcome email for a new company's Super Admin: an invite link to set a password, or (when the platform
   * owner set a temporary password) the sign-in details without the password itself.
   */
  async sendCompanyWelcome(tx: Tx, tenantId: string, admin: { id: string; email: string; name: string }, invite: boolean) {
    const [tenant] = await tx.select({ name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    const app = config().APP_URL;
    let action: string;
    if (invite) {
      const secret = randomToken(32);
      await tx.update(userTokens).set({ usedAt: new Date() }).where(and(eq(userTokens.userId, admin.id), eq(userTokens.purpose, 'INVITE'), isNull(userTokens.usedAt)));
      await tx.insert(userTokens).values({ tenantId, userId: admin.id, purpose: 'INVITE', tokenHash: sha256(secret), expiresAt: new Date(Date.now() + INVITE_TTL_H * 3600_000) });
      const link = `${app}/reset-password?token=${encodeURIComponent(`${tenantId}.${secret}`)}&invite=1`;
      action = `1. Set your password (this link works for ${INVITE_TTL_H} hours):\n   ${link}\n2. Then sign in at ${app}/login`;
    } else {
      action = `Sign in at ${app}/login with the temporary password your provider gave you. You'll be asked to choose your own password.`;
    }
    await this.mail.send({
      to: admin.email,
      subject: `Your ${tenant?.name} HR workspace is ready`,
      text: [
        `Hi ${admin.name},`,
        '',
        `Your company workspace "${tenant?.name}" has been created and you are its Company Admin.`,
        '',
        `Workspace: ${tenant?.slug}`,
        `Your email: ${admin.email}`,
        '',
        action,
        '',
        'As Company Admin you can add employees, departments and levels, and decide what each role may do under Access & roles.',
        '',
        'If you did not expect this email, you can ignore it.',
      ].join('\n'),
    });
  }

  /** Always succeeds from the caller's view, so accounts can't be enumerated. */
  /** Without a workspace, a reset link is sent for every company the email belongs to. */
  async forgotPassword(workspace: string | undefined, email: string) {
    if (!workspace) {
      for (const s of await this.workspacesFor(email)) await this.forgotPassword(s.slug, email);
      return;
    }
    const [tenant] = await this.db.root.select().from(tenants).where(eq(tenants.slug, workspace)).limit(1);
    if (!tenant || tenant.status !== 'ACTIVE') return;
    await this.db.inTenant(tenant.id, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || user.status === 'DISABLED') return;
      await this.sendTokenEmail(tx, tenant.id, user, 'PASSWORD_RESET');
      await this.audit.log(tx, { tenantId: tenant.id, action: 'auth.password_reset_requested', actorUserId: user.id, actorLabel: user.email });
    });
  }

  async resetPassword(rawToken: string, password: string): Promise<{ workspace: string; email: string }> {
    const parts = splitToken(rawToken);
    if (!parts) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
    return this.db.inTenant(parts.tenantId, async (tx) => {
      const [tok] = await tx.select().from(userTokens).where(eq(userTokens.tokenHash, sha256(parts.secret))).limit(1);
      if (!tok || tok.usedAt || tok.expiresAt < new Date()) throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
      const [user] = await tx.select().from(users).where(eq(users.id, tok.userId)).limit(1);
      if (!user || user.status === 'DISABLED') throw badRequest('This link is invalid or has expired', 'INVALID_TOKEN');
      await tx.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, tok.id));
      await tx
        .update(users)
        .set({
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          status: 'ACTIVE',
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: user.tokenVersion + 1,
        })
        .where(eq(users.id, user.id));
      await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
      await this.audit.log(tx, { tenantId: parts.tenantId, action: tok.purpose === 'INVITE' ? 'auth.invite_accepted' : 'auth.password_reset', actorUserId: user.id, actorLabel: user.email });
      const [tenant] = await tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, parts.tenantId));
      return { workspace: tenant!.slug, email: user.email };
    });
  }

  async changePassword(userId: string, current: string, next: string) {
    const tx = this.db.tx;
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, current))) throw badRequest('Current password is incorrect', 'INVALID_PASSWORD');
    if (current === next) throw badRequest('Choose a password you have not just used');
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(next), passwordChangedAt: new Date(), mustChangePassword: false, tokenVersion: user.tokenVersion + 1 })
      .where(eq(users.id, userId));
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    return this.issue(tx, user.tenantId, userId, user.tokenVersion + 1);
  }

  /* ---------------- Current session ---------------- */

  async me() {
    const store = als.getStore()!;
    const u = store.user!;
    const tx = this.db.tx;
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, u.tenantId));
    const [user] = await tx.select().from(users).where(eq(users.id, u.userId));
    const emp = u.employeeId
      ? (
          await tx
            .select({
              id: employees.id,
              employeeCode: employees.employeeCode,
              fullName: employees.fullName,
              designation: employees.designation,
              avatarFileId: employees.avatarFileId,
              departmentId: employees.departmentId,
              departmentName: departments.name,
              onboardingCompletedAt: employees.onboardingCompletedAt,
              medicalEligible: employees.medicalEligible,
            })
            .from(employees)
            .innerJoin(departments, eq(departments.id, employees.departmentId))
            .where(eq(employees.id, u.employeeId))
        )[0]
      : null;
    const [latestGuidelines] = await tx.select({ version: guidelineVersions.version }).from(guidelineVersions).orderBy(desc(guidelineVersions.version)).limit(1);
    const accepted = latestGuidelines
      ? (await tx
          .select({ v: guidelineAcceptances.version })
          .from(guidelineAcceptances)
          .where(and(eq(guidelineAcceptances.userId, u.userId), eq(guidelineAcceptances.version, latestGuidelines.version)))
          .limit(1)).length > 0
      : true;
    return {
      user: {
        id: u.userId,
        email: u.email,
        roles: u.roles,
        permissions: [...u.permissions],
        ledTeamIds: u.ledTeamIds,
        canPost: u.canPost,
        mustChangePassword: user?.mustChangePassword ?? false,
        guidelinesAccepted: accepted,
      },
      employee: emp ?? null,
      onboardingRequired: !!emp && !emp.onboardingCompletedAt,
      tenant: { id: tenant!.id, name: tenant!.name, slug: tenant!.slug, timezone: tenant!.timezone, currency: tenant!.currency, logoFileId: tenant!.logoFileId, emailDomain: tenant!.emailDomain, modules: tenant!.modules, maxEmployees: tenant!.maxEmployees, settings: tenant!.settings, billingStatus: tenant!.billingStatus, billingCycle: tenant!.billingCycle, paidUntil: tenant!.paidUntil, isDemo: tenant!.isDemo },
    };
  }
}
