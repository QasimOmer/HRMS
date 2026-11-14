import { Body, Controller, Get, HttpCode, Post, Query, Res, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { demoRequestSchema, signupSchema, type DemoRequestInput, type SignupInput } from '@hrms/shared';
import type { Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { Public, SkipAudit } from '../../common/decorators';
import { badRequest } from '../../common/errors';
import { zp } from '../../common/zod.pipe';
import { DbService } from '../../db/db.service';
import { marketingLeads, platformPlans, tenants, userRoles, users } from '../../db/schema';
import { AuthService } from '../auth/auth.service';
import { setSessionCookies } from '../auth/tokens';
import { BillingService } from './billing.service';
import { PlatformSettingsService, type BrandImage } from './platform-settings.service';

/** Workspace name from the company name, made unique with a short suffix when needed. */
async function freeWorkspace(db: DbService, companyName: string): Promise<string> {
  const base = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'company';
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 && base.length >= 3 ? base : `${base}-${randomBytes(2).toString('hex')}`;
    const [taken] = await db.root.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug)).limit(1);
    if (!taken) return slug;
  }
  return `company-${randomBytes(4).toString('hex')}`;
}

/** Public website endpoints: branding, plans, self-service sign-up and the read-only demo (no company data). */
@Controller('public')
@Public()
@SkipAudit()
export class BrandingController {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly billing: BillingService,
  ) {}

  @Get('branding')
  branding() {
    return this.settings.branding();
  }

  @Get('plans')
  plans() {
    return this.settings.publicPlans();
  }

  @Get('logo')
  logo(@Query('v') v: string | undefined, @Res() res: Response) {
    return this.send('logo', v, res);
  }

  /** Falls back to the built-in icon so the browser always gets a favicon. */
  @Get('favicon')
  favicon(@Query('v') v: string | undefined, @Res() res: Response) {
    return this.send('favicon', v, res);
  }

  /**
   * Website sign-up: creates the company on the chosen plan and cycle, opens the first invoice and signs
   * the Company Admin in. The workspace stays on Billing until the Super Admin confirms the payment.
   */
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @HttpCode(200)
  async signup(@Body(zp(signupSchema)) body: SignupInput, @Res({ passthrough: true }) res: Response) {
    const [plan] = await this.db.root.select().from(platformPlans).where(and(eq(platformPlans.id, body.planId), eq(platformPlans.isActive, true)));
    if (!plan) throw badRequest('Choose one of the plans shown', 'PLAN_NOT_FOUND');
    const workspace = await freeWorkspace(this.db, body.companyName);
    const { tenantId, userId } = await this.auth.createCompany(
      { companyName: body.companyName, workspace, adminName: body.adminName, email: body.email, password: body.password, mustChangePassword: false, planId: plan.id, timezone: 'Asia/Karachi', currency: plan.currency },
      'website sign-up',
    );
    await this.db.inTenant(tenantId, (tx) => tx.update(tenants).set({ signupSource: 'SELF', billingCycle: body.cycle, billingStatus: 'UNPAID' }).where(eq(tenants.id, tenantId)));
    const invoice = await this.billing.createInvoice(tenantId);
    await this.db.root.insert(marketingLeads).values({ email: body.email, name: body.adminName, company: body.companyName, phone: body.phone, source: 'SIGNUP', planId: plan.id });
    const t = await this.auth.sessionFor(tenantId, userId);
    setSessionCookies(res, t.access, t.refresh);
    return { ok: true, workspace, invoiceId: invoice.id };
  }

  /** "Try the demo": records who is looking, then signs them into the read-only demo company. */
  @Post('demo')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  async demo(@Body(zp(demoRequestSchema)) body: DemoRequestInput, @Res({ passthrough: true }) res: Response) {
    // Save the lead first: even if the demo company isn't ready, the Super Admin can still follow up.
    await this.db.root.insert(marketingLeads).values({ email: body.email, name: body.name, company: body.company, phone: body.phone, source: 'DEMO' });
    const [demo] = await this.db.root.select({ id: tenants.id }).from(tenants).where(and(eq(tenants.isDemo, true), eq(tenants.status, 'ACTIVE'))).limit(1);
    if (!demo) throw new ServiceUnavailableException({ message: "Thanks! The live demo isn't available right now; we've saved your details and will be in touch.", code: 'DEMO_UNAVAILABLE' });
    const [admin] = await this.db.inTenant(demo.id, (tx) =>
      tx.select({ id: users.id }).from(users).innerJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.role, 'SUPER_ADMIN'))).where(eq(users.status, 'ACTIVE')).limit(1),
    );
    if (!admin) throw new ServiceUnavailableException({ message: "Thanks! The live demo isn't available right now; we've saved your details and will be in touch.", code: 'DEMO_UNAVAILABLE' });
    const t = await this.auth.sessionFor(demo.id, admin.id);
    setSessionCookies(res, t.access, t.refresh);
    return { ok: true };
  }

  private async send(kind: BrandImage, version: string | undefined, res: Response) {
    const img = await this.settings.image(kind);
    if (!img) {
      res.setHeader('Cache-Control', 'no-cache');
      return kind === 'favicon' ? res.redirect(302, '/brand-icon.svg') : res.status(404).json({ message: 'No logo set', code: 'NOT_FOUND' });
    }
    res.setHeader('Content-Type', img.type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    // Versioned URLs never change; unversioned ones are checked again soon.
    res.setHeader('Cache-Control', version ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
    return res.send(img.data);
  }
}
