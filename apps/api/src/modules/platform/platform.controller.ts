import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { companyUpdateSchema, createCompanySchema, planSchema, platformAdminSchema, platformLoginSchema, platformSettingsSchema, brandImageSchema, markPaidSchema, paymentMethodSchema, type PaymentMethodInput, type PlatformSettingsInput, testEmailSchema, type CompanyUpdateInput, type CreateCompanyInput, type PlanInput } from '@hrms/shared';
import type { Request, Response } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { hashPassword, verifyPassword } from '../../common/crypto';
import { Public, SkipAudit } from '../../common/decorators';
import { badRequest, conflict, notFound } from '../../common/errors';
import { loginAttempts } from '../../common/attempt-limiter';
import { zp } from '../../common/zod.pipe';
import { domainUsedByOther } from '../../common/email-domains';
import { DbService } from '../../db/db.service';
import { MailService } from '../../core/mail.service';
import { employees, marketingLeads, platformAdmins, platformPaymentMethods, platformPlans, tenants, userRoles, users } from '../../db/schema';
import { AccessService } from '../auth/access.service';
import { PlatformSettingsService } from './platform-settings.service';
import { BillingService } from './billing.service';
import { AuthService } from '../auth/auth.service';
import { lockMinutesFor, waitText } from '../auth/lockout';
import { PLATFORM_COOKIE, clearPlatformCookie, setPlatformCookie, signPlatformToken, verifyPlatformToken } from '../auth/tokens';

type Admin = typeof platformAdmins.$inferSelect;

/**
 * Platform console for the SaaS operator: create client companies with their Super Admin,
 * suspend or reactivate them, and add other platform owners. Uses its own session cookie,
 * separate from company logins (still protected by the global CSRF check).
 */
@Controller('platform')
@Public()
@SkipAudit()
export class PlatformController {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly mail: MailService,
    private readonly settings: PlatformSettingsService,
    private readonly billing: BillingService,
  ) {}

  private async requireAdmin(req: Request): Promise<Admin> {
    const token = req.cookies?.[PLATFORM_COOKIE];
    const claims = typeof token === 'string' ? await verifyPlatformToken(token) : null;
    if (!claims) throw new UnauthorizedException({ message: 'Please sign in to the platform console', code: 'UNAUTHENTICATED' });
    const [admin] = await this.db.root.select().from(platformAdmins).where(eq(platformAdmins.id, claims.sub));
    if (!admin || admin.tokenVersion !== claims.ver) throw new UnauthorizedException({ message: 'Session expired', code: 'UNAUTHENTICATED' });
    return admin;
  }

  /* ---------------- Session ---------------- */

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(zp(platformLoginSchema)) body: z.infer<typeof platformLoginSchema>, @Res({ passthrough: true }) res: Response) {
    loginAttempts.hit(`platform:${body.email}`);
    const [admin] = await this.db.root.select().from(platformAdmins).where(eq(platformAdmins.email, body.email));
    const ok = await verifyPassword(admin?.passwordHash, body.password);
    const invalid = () => new UnauthorizedException({ message: 'Email or password is incorrect', code: 'INVALID_CREDENTIALS' });
    if (!admin) throw invalid();
    if (admin.lockedUntil && admin.lockedUntil > new Date()) throw new UnauthorizedException({ message: `Account temporarily locked. Try again in ${waitText(admin.lockedUntil)}.`, code: 'LOCKED' });
    if (!ok) {
      const failed = admin.failedLoginCount + 1;
      const lock = lockMinutesFor(failed);
      await this.db.root.update(platformAdmins).set({ failedLoginCount: failed, lockedUntil: lock ? new Date(Date.now() + lock * 60_000) : null }).where(eq(platformAdmins.id, admin.id));
      throw invalid();
    }
    await this.db.root.update(platformAdmins).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(platformAdmins.id, admin.id));
    setPlatformCookie(res, await signPlatformToken(admin.id, admin.tokenVersion));
    return { ok: true };
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    clearPlatformCookie(res);
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const a = await this.requireAdmin(req);
    return { id: a.id, name: a.name, email: a.email };
  }

  /* ---------------- Companies ---------------- */

  @Get('companies')
  async companies(@Req() req: Request) {
    await this.requireAdmin(req);
    const rows = await this.db.root.select().from(tenants).orderBy(asc(tenants.name));
    const plans = await this.db.root.select({ id: platformPlans.id, name: platformPlans.name }).from(platformPlans);
    // Employee data is behind RLS, so count inside each company's own scope.
    return Promise.all(
      rows.map(async (t) => {
        const [c] = await this.db.inTenant(t.id, (tx) => tx.select({ n: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'ACTIVE')::int` }).from(employees));
        return {
          id: t.id, name: t.name, slug: t.slug, status: t.status, timezone: t.timezone, currency: t.currency,
          activeEmployees: c?.n ?? 0, maxEmployees: t.maxEmployees, modules: t.modules,
          planId: t.planId, planName: plans.find((p) => p.id === t.planId)?.name ?? null, createdAt: t.createdAt,
          billingCycle: t.billingCycle, billingStatus: t.billingStatus, paidUntil: t.paidUntil, signupSource: t.signupSource, isDemo: t.isDemo,
        };
      }),
    );
  }

  @Get('companies/:id')
  async company(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    const [t] = await this.db.root.select().from(tenants).where(eq(tenants.id, id));
    if (!t) throw notFound('Company');
    return this.db.inTenant(id, async (tx) => {
      const [c] = await tx.select({ active: sql<number>`count(*) filter (where ${employees.employmentStatus} = 'ACTIVE')::int`, total: sql<number>`count(*)::int` }).from(employees);
      const admins = await tx
        .select({ id: users.id, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt, name: employees.fullName })
        .from(users)
        .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'SUPER_ADMIN')))
        .leftJoin(employees, eq(employees.id, users.employeeId));
      return {
        id: t.id, name: t.name, slug: t.slug, status: t.status, timezone: t.timezone, currency: t.currency,
        planId: t.planId, modules: t.modules, maxEmployees: t.maxEmployees, emailDomain: t.emailDomain, extraEmailDomains: t.extraEmailDomains, createdAt: t.createdAt,
        activeEmployees: c?.active ?? 0, totalEmployees: c?.total ?? 0, superAdmins: admins,
        billingCycle: t.billingCycle, billingStatus: t.billingStatus, paidUntil: t.paidUntil, signupSource: t.signupSource, isDemo: t.isDemo,
      };
    });
  }

  @Post('companies')
  async createCompany(@Req() req: Request, @Body(zp(createCompanySchema)) body: CreateCompanyInput) {
    const admin = await this.requireAdmin(req);
    const [taken] = await this.db.root.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, body.workspace));
    if (taken) throw conflict('That workspace name is taken', 'WORKSPACE_TAKEN');
    return this.auth.createCompany(body, admin.email);
  }

  /** Change a company's plan, modules, employee limit, name or status. Choosing a plan copies its modules and limit. */
  @Patch('companies/:id')
  async updateCompany(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zp(companyUpdateSchema)) body: CompanyUpdateInput) {
    await this.requireAdmin(req);
    const set: Partial<typeof tenants.$inferInsert> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.status !== undefined) set.status = body.status;
    if (body.planId !== undefined) {
      set.planId = body.planId;
      if (body.planId) {
        const [plan] = await this.db.root.select().from(platformPlans).where(eq(platformPlans.id, body.planId));
        if (!plan) throw badRequest('Choose a valid plan', 'PLAN_NOT_FOUND');
        set.modules = plan.modules;
        set.maxEmployees = plan.maxEmployees;
      }
    }
    if (body.modules !== undefined) set.modules = body.modules;
    if (body.maxEmployees !== undefined) set.maxEmployees = body.maxEmployees;
    if (body.billingCycle !== undefined) set.billingCycle = body.billingCycle; // applies from the next invoice
    if (body.isDemo !== undefined) set.isDemo = body.isDemo;
    if (body.emailDomain !== undefined) {
      if (await domainUsedByOther(this.db, body.emailDomain, id)) throw conflict(`The email domain ${body.emailDomain} is already used by another company`, 'DOMAIN_TAKEN');
      set.emailDomain = body.emailDomain; // existing accounts keep their emails; new ones use the new domain
    }
    if (body.extraEmailDomains !== undefined) {
      const [cur] = await this.db.root.select({ main: tenants.emailDomain }).from(tenants).where(eq(tenants.id, id));
      const main = set.emailDomain ?? cur?.main;
      const extra = [...new Set(body.extraEmailDomains)].filter((d) => d !== main);
      for (const d of extra) {
        if (await domainUsedByOther(this.db, d, id)) throw conflict(`The email domain ${d} is already used by another company`, 'DOMAIN_TAKEN');
      }
      set.extraEmailDomains = extra;
    }
    // Tenants can only be updated from inside their own scope (RLS policy).
    const [row] = await this.db.inTenant(id, (tx) => tx.update(tenants).set(set).where(eq(tenants.id, id)).returning({ id: tenants.id, status: tenants.status, planId: tenants.planId, modules: tenants.modules, maxEmployees: tenants.maxEmployees }));
    if (!row) throw notFound('Company');
    this.access.forgetAll(); // module and status changes apply on the next request
    return row;
  }

  /** Re-send the welcome email (with a fresh password link if they never set one) to the company's Super Admins. */
  @Post('companies/:id/welcome')
  @HttpCode(200)
  async resendWelcome(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    return this.db.inTenant(id, async (tx) => {
      const admins = await tx
        .select({ id: users.id, email: users.email, status: users.status, name: employees.fullName })
        .from(users)
        .innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'SUPER_ADMIN')))
        .leftJoin(employees, eq(employees.id, users.employeeId));
      for (const a of admins) await this.auth.sendCompanyWelcome(tx, id, { id: a.id, email: a.email, name: a.name ?? a.email }, a.status === 'INVITED');
      return { sent: admins.map((a) => a.email) };
    });
  }

  /* ---------------- Plans (general settings for all companies) ---------------- */

  @Get('plans')
  async plans(@Req() req: Request) {
    await this.requireAdmin(req);
    const rows = await this.db.root.select().from(platformPlans).orderBy(asc(platformPlans.priceMonthly));
    const used = await this.db.root.select({ planId: tenants.planId, n: sql<number>`count(*)::int` }).from(tenants).groupBy(tenants.planId);
    return rows.map((p) => ({ ...p, companies: used.find((u) => u.planId === p.id)?.n ?? 0 }));
  }

  @Post('plans')
  async createPlan(@Req() req: Request, @Body(zp(planSchema)) body: PlanInput) {
    await this.requireAdmin(req);
    const [dupe] = await this.db.root.select({ id: platformPlans.id }).from(platformPlans).where(eq(platformPlans.name, body.name));
    if (dupe) throw conflict('A plan with this name already exists', 'NAME_TAKEN');
    const { defaultCurrency } = await this.settings.get();
    const [row] = await this.db.root.insert(platformPlans).values({ ...body, currency: defaultCurrency, maxEmployees: body.maxEmployees ?? null }).returning();
    return row;
  }

  /** Editing a plan doesn't change companies already on it; re-apply the plan on a company to update it. */
  @Put('plans/:id')
  async updatePlan(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zp(planSchema)) body: PlanInput) {
    await this.requireAdmin(req);
    const { defaultCurrency } = await this.settings.get();
    const [row] = await this.db.root.update(platformPlans).set({ ...body, currency: defaultCurrency, maxEmployees: body.maxEmployees ?? null }).where(eq(platformPlans.id, id)).returning();
    if (!row) throw notFound('Plan');
    return row;
  }

  @Delete('plans/:id')
  async deletePlan(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    const [{ n }] = (await this.db.root.select({ n: sql<number>`count(*)::int` }).from(tenants).where(eq(tenants.planId, id))) as [{ n: number }];
    if (n > 0) throw conflict(`This plan is used by ${n} compan${n === 1 ? 'y' : 'ies'}. Move them to another plan or deactivate it instead.`, 'IN_USE');
    await this.db.root.delete(platformPlans).where(eq(platformPlans.id, id));
    return { id, deleted: true };
  }

  /* ---------------- Billing ---------------- */

  @Get('companies/:id/billing')
  async companyBilling(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    const invoices = await this.billing.invoices(id);
    const methods = await this.db.root.select({ id: platformPaymentMethods.id, name: platformPaymentMethods.name }).from(platformPaymentMethods);
    return invoices.map((i) => ({ ...i, paymentMethodName: methods.find((m) => m.id === i.paymentMethodId)?.name ?? null }));
  }

  /** Opens the next period's invoice (or the first one) at the plan's current price. */
  @Post('companies/:id/invoices')
  async createInvoice(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    return this.billing.createInvoice(id);
  }

  @Post('invoices/:id/paid')
  @HttpCode(200)
  async markPaid(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zp(markPaidSchema)) body: z.infer<typeof markPaidSchema>) {
    const admin = await this.requireAdmin(req);
    return this.billing.markPaid(id, body.note ?? `Marked paid by ${admin.email}`);
  }

  @Post('companies/:id/unpaid')
  @HttpCode(200)
  async markUnpaid(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: { invoiceId?: string }) {
    await this.requireAdmin(req);
    return this.billing.markUnpaid(id, typeof body?.invoiceId === 'string' ? body.invoiceId : undefined);
  }

  @Post('invoices/:id/void')
  @HttpCode(200)
  async voidInvoice(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    return this.billing.voidInvoice(id);
  }

  @Get('payment-methods')
  async paymentMethods(@Req() req: Request) {
    await this.requireAdmin(req);
    return this.db.root.select().from(platformPaymentMethods).orderBy(asc(platformPaymentMethods.sortOrder), asc(platformPaymentMethods.name));
  }

  @Post('payment-methods')
  async createPaymentMethod(@Req() req: Request, @Body(zp(paymentMethodSchema)) body: PaymentMethodInput) {
    await this.requireAdmin(req);
    const [row] = await this.db.root.insert(platformPaymentMethods).values(body).returning();
    return row;
  }

  @Put('payment-methods/:id')
  async updatePaymentMethod(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body(zp(paymentMethodSchema)) body: PaymentMethodInput) {
    await this.requireAdmin(req);
    const [row] = await this.db.root.update(platformPaymentMethods).set({ ...body, updatedAt: new Date() }).where(eq(platformPaymentMethods.id, id)).returning();
    if (!row) throw notFound('Payment method');
    return row;
  }

  @Delete('payment-methods/:id')
  async deletePaymentMethod(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    await this.requireAdmin(req);
    await this.db.root.delete(platformPaymentMethods).where(eq(platformPaymentMethods.id, id));
    return { id, deleted: true };
  }

  /** People who tried the demo or signed up on the website (marketing). */
  @Get('leads')
  async leads(@Req() req: Request) {
    await this.requireAdmin(req);
    return this.db.root.select().from(marketingLeads).orderBy(desc(marketingLeads.createdAt)).limit(1000);
  }

  /* ---------------- General settings ---------------- */

  @Get('settings')
  async getSettings(@Req() req: Request) {
    await this.requireAdmin(req);
    return this.settings.get();
  }

  @Put('settings')
  async putSettings(@Req() req: Request, @Body(zp(platformSettingsSchema)) body: PlatformSettingsInput) {
    await this.requireAdmin(req);
    return this.settings.update(body);
  }

  @Put('settings/logo')
  async putLogo(@Req() req: Request, @Body(zp(brandImageSchema)) body: z.infer<typeof brandImageSchema>) {
    await this.requireAdmin(req);
    return this.settings.setImage('logo', body.data);
  }

  @Put('settings/favicon')
  async putFavicon(@Req() req: Request, @Body(zp(brandImageSchema)) body: z.infer<typeof brandImageSchema>) {
    await this.requireAdmin(req);
    return this.settings.setImage('favicon', body.data);
  }

  /* ---------------- Email (SMTP) ---------------- */

  @Get('email')
  async emailStatus(@Req() req: Request) {
    await this.requireAdmin(req);
    return this.mail.status();
  }

  @Post('email/test')
  @HttpCode(200)
  async testEmail(@Req() req: Request, @Body(zp(testEmailSchema)) body: z.infer<typeof testEmailSchema>) {
    const admin = await this.requireAdmin(req);
    try {
      return await this.mail.sendNow({ to: body.to, subject: `${await this.settings.name()} test email`, text: `This is a test email from the ${await this.settings.name()} platform console, sent by ${admin.email}.\n\nIf you received it, outgoing email works.` });
    } catch (e) {
      throw badRequest(`The mail server refused: ${(e as Error).message}`, 'SMTP_ERROR');
    }
  }

  /* ---------------- Platform owners ---------------- */

  @Get('admins')
  async admins(@Req() req: Request) {
    await this.requireAdmin(req);
    return this.db.root
      .select({ id: platformAdmins.id, name: platformAdmins.name, email: platformAdmins.email, lastLoginAt: platformAdmins.lastLoginAt, createdAt: platformAdmins.createdAt })
      .from(platformAdmins)
      .orderBy(asc(platformAdmins.name));
  }

  /** Only an existing platform owner can add another one. */
  @Post('admins')
  async addAdmin(@Req() req: Request, @Body(zp(platformAdminSchema)) body: z.infer<typeof platformAdminSchema>) {
    const admin = await this.requireAdmin(req);
    const [exists] = await this.db.root.select({ id: platformAdmins.id }).from(platformAdmins).where(eq(platformAdmins.email, body.email));
    if (exists) throw conflict('A Super Admin with this email already exists', 'EMAIL_TAKEN');
    const [row] = await this.db.root
      .insert(platformAdmins)
      .values({ name: body.name, email: body.email, passwordHash: await hashPassword(body.password), createdByAdminId: admin.id })
      .returning({ id: platformAdmins.id, name: platformAdmins.name, email: platformAdmins.email });
    return row;
  }
}
