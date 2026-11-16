import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { config } from '../../config';
import { BILLING_GRACE_DAYS, invoiceTotal, planPrice, type BillingCycle, type CustomInvoiceInput } from '@hrms/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';
import { badRequest, notFound } from '../../common/errors';
import { addDays, todayIn } from '../../common/tz';
import { DbService } from '../../db/db.service';
import { billingInvoices, platformPaymentMethods, platformPlans, tenants } from '../../db/schema';
import { AccessService } from '../auth/access.service';
import { renderInvoicePdf } from './invoice.pdf';
import { PlatformSettingsService } from './platform-settings.service';

type Plan = typeof platformPlans.$inferSelect;

/** Last day of a billing period that starts on `start` (YYYY-MM-DD). */
export function periodEnd(start: string, cycle: BillingCycle): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const next = cycle === 'ANNUAL' ? new Date(Date.UTC(y + 1, m - 1, d)) : new Date(Date.UTC(y, m, d));
  // Months without that day (e.g. 31 Jan + 1 month) roll back to the month's last day.
  if (cycle === 'MONTHLY' && next.getUTCDate() !== d) next.setUTCDate(0);
  return addDays(next.toISOString().slice(0, 10), -1);
}

/**
 * Subscription billing for companies: invoices per period, payment status and the monthly / annual cycle.
 * There is no card gateway yet: companies pay by one of the Super Admin's payment methods, enter the
 * reference, and the Super Admin marks the invoice paid.
 */
@Injectable()
export class BillingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Billing');
  private timer?: NodeJS.Timeout;

  onApplicationBootstrap() {
    if (!config().ENABLE_SCHEDULER || process.env.NODE_ENV === 'test') return;
    setTimeout(() => void this.runCycle(), 15_000).unref();
    this.timer = setInterval(() => void this.runCycle(), 60 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  constructor(
    private readonly db: DbService,
    private readonly access: AccessService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /** Next invoice number, e.g. INV-2026-00012 (one sequence for the whole platform). */
  private async nextNumber(): Promise<string> {
    const r = await this.db.root.execute(sql`select nextval('billing_invoice_number_seq')::int as n`);
    const n = Number((r as unknown as { rows: { n: number }[] }).rows[0]!.n);
    return `INV-${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
  }

  private async dueDateFrom(from: string): Promise<string> {
    return addDays(from, (await this.settings.invoiceTemplate()).paymentTermsDays);
  }

  private async plan(planId: string | null): Promise<Plan | undefined> {
    if (!planId) return undefined;
    const [p] = await this.db.root.select().from(platformPlans).where(eq(platformPlans.id, planId));
    return p;
  }

  private async tenant(tenantId: string) {
    const [t] = await this.db.root.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw notFound('Company');
    return t;
  }

  /** Tenants can only be changed from inside their own RLS scope. */
  private async updateTenant(tenantId: string, set: Partial<typeof tenants.$inferInsert>) {
    await this.db.inTenant(tenantId, (tx) => tx.update(tenants).set(set).where(eq(tenants.id, tenantId)));
    this.access.forgetAll(); // lock / unlock applies on the next request
  }

  /** Opens an invoice for one period at the plan's current price. */
  async createInvoice(tenantId: string, start?: string) {
    const t = await this.tenant(tenantId);
    const plan = await this.plan(t.planId);
    if (!plan) throw badRequest('Put the company on a plan first', 'NO_PLAN');
    const from = start ?? (t.paidUntil ? addDays(t.paidUntil, 1) : todayIn(t.timezone));
    const [open] = await this.db.root.select({ id: billingInvoices.id }).from(billingInvoices)
      .where(and(eq(billingInvoices.tenantId, tenantId), eq(billingInvoices.periodStart, from), ne(billingInvoices.status, 'VOID')));
    if (open) throw badRequest('There is already an invoice for that period', 'INVOICE_EXISTS');
    const amount = planPrice(plan, t.billingCycle);
    const to = periodEnd(from, t.billingCycle);
    const cycleWord = t.billingCycle === 'ANNUAL' ? 'yearly' : 'monthly';
    const [row] = await this.db.root.insert(billingInvoices).values({
      tenantId,
      planId: plan.id,
      planName: plan.name,
      number: await this.nextNumber(),
      kind: 'SUBSCRIPTION',
      title: `${plan.name} subscription (${cycleWord})`,
      items: [{ description: `${plan.name} plan, ${cycleWord}: ${from} to ${to}`, quantity: 1, unitPrice: amount }],
      dueDate: await this.dueDateFrom(from),
      cycle: t.billingCycle,
      amount,
      currency: plan.currency,
      periodStart: from,
      periodEnd: to,
    }).returning();
    // Free plan (price 0): nothing to pay, so the period counts as paid straight away.
    if (row!.amount <= 0) {
      await this.markPaid(row!.id, 'Free plan: no payment needed');
      return { ...row!, status: 'PAID' as const };
    }
    return row!;
  }

  /**
   * Super Admin bills something by hand (setup, training, extra users…): what it's for, the lines and the
   * due date. It doesn't change the subscription period or lock the workspace.
   */
  async createCustomInvoice(tenantId: string, input: CustomInvoiceInput) {
    const t = await this.tenant(tenantId);
    const plan = await this.plan(t.planId);
    const currency = plan?.currency ?? (await this.settings.get()).defaultCurrency;
    const today = todayIn(t.timezone);
    const amount = invoiceTotal(input.items);
    const [row] = await this.db.root.insert(billingInvoices).values({
      tenantId,
      planId: plan?.id ?? null,
      planName: plan?.name ?? 'Custom',
      number: await this.nextNumber(),
      kind: 'CUSTOM',
      title: input.title,
      items: input.items,
      dueDate: input.dueDate ?? (await this.dueDateFrom(today)),
      note: input.notes ?? null,
      cycle: t.billingCycle,
      amount,
      currency,
      periodStart: today,
      periodEnd: today,
    }).returning();
    if (row!.amount <= 0) {
      await this.markPaid(row!.id, 'Nothing to pay');
      return { ...row!, status: 'PAID' as const };
    }
    return row!;
  }

  /** One invoice (optionally checked to belong to a company). */
  async invoice(invoiceId: string, tenantId?: string) {
    const [inv] = await this.db.root.select().from(billingInvoices).where(eq(billingInvoices.id, invoiceId));
    if (!inv || (tenantId && inv.tenantId !== tenantId)) throw notFound('Invoice');
    const [m] = inv.paymentMethodId ? await this.db.root.select({ name: platformPaymentMethods.name }).from(platformPaymentMethods).where(eq(platformPaymentMethods.id, inv.paymentMethodId)) : [];
    const t = await this.tenant(inv.tenantId);
    return { ...inv, paymentMethodName: m?.name ?? null, company: { name: t.name, workspace: t.slug, emailDomain: t.emailDomain } };
  }

  /** The invoice as a PDF, styled by the Super Admin's invoice template. */
  async invoicePdf(invoiceId: string, tenantId?: string): Promise<{ file: Buffer; name: string }> {
    const inv = await this.invoice(invoiceId, tenantId);
    const [template, platformName, logo] = await Promise.all([this.settings.invoiceTemplate(), this.settings.name(), this.settings.image('logo')]);
    const items = inv.items.length ? inv.items : [{ description: inv.title ?? inv.planName, quantity: 1, unitPrice: inv.amount }];
    const file = await renderInvoicePdf({
      number: inv.number ?? inv.id.slice(0, 8).toUpperCase(),
      title: inv.title ?? `${inv.planName} subscription`,
      status: inv.status,
      issuedOn: inv.createdAt.toISOString().slice(0, 10),
      dueDate: inv.dueDate,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      kind: inv.kind,
      currency: inv.currency,
      items,
      total: inv.amount,
      notes: inv.kind === 'CUSTOM' ? inv.note : null,
      paidAt: inv.paidAt ? inv.paidAt.toISOString() : null,
      paymentReference: inv.paymentReference,
      company: inv.company,
      template,
      platformName,
      logo,
    });
    return { file, name: `${inv.number ?? 'invoice'}.pdf` };
  }

  /** Super Admin confirms the money arrived: the company is paid up to the end of that period. */
  async markPaid(invoiceId: string, note?: string) {
    const [inv] = await this.db.root.select().from(billingInvoices).where(eq(billingInvoices.id, invoiceId));
    if (!inv) throw notFound('Invoice');
    if (inv.status === 'VOID') throw badRequest('This invoice was cancelled');
    await this.db.root.update(billingInvoices).set({ status: 'PAID', paidAt: new Date(), note: note ?? inv.note, updatedAt: new Date() }).where(eq(billingInvoices.id, invoiceId));
    // A custom invoice is just paid; only subscription invoices move the paid-until date and lift a lock.
    if (inv.kind === 'CUSTOM') return { id: invoiceId, status: 'PAID' as const, paidUntil: null };
    const t = await this.tenant(inv.tenantId);
    const paidUntil = !t.paidUntil || inv.periodEnd > t.paidUntil ? inv.periodEnd : t.paidUntil;
    await this.updateTenant(inv.tenantId, { billingStatus: 'PAID', paidUntil });
    return { id: invoiceId, status: 'PAID' as const, paidUntil };
  }

  /** Super Admin: money not received (or refunded). The invoice goes back to pending and the company is locked. */
  async markUnpaid(tenantId: string, invoiceId?: string) {
    if (invoiceId) {
      const [inv] = await this.db.root.update(billingInvoices).set({ status: 'PENDING', paidAt: null, updatedAt: new Date() }).where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.tenantId, tenantId))).returning({ kind: billingInvoices.kind });
      // Reopening a custom invoice doesn't pause the workspace.
      if (inv?.kind === 'CUSTOM') return { tenantId, billingStatus: (await this.tenant(tenantId)).billingStatus };
    }
    await this.updateTenant(tenantId, { billingStatus: 'UNPAID' });
    return { tenantId, billingStatus: 'UNPAID' as const };
  }

  async voidInvoice(invoiceId: string) {
    await this.db.root.update(billingInvoices).set({ status: 'VOID', updatedAt: new Date() }).where(and(eq(billingInvoices.id, invoiceId), ne(billingInvoices.status, 'PAID')));
    return { id: invoiceId, status: 'VOID' as const };
  }

  /**
   * Company switches between monthly and yearly billing. Applies from the next invoice; an open invoice
   * they haven't paid yet is replaced by one at the new price for the same start date. An invoice they've
   * already sent a payment reference for is left alone (the money may already be on its way).
   */
  async changeCycle(tenantId: string, cycle: BillingCycle) {
    const t = await this.tenant(tenantId);
    if (t.billingCycle === cycle) return { billingCycle: cycle, replacedInvoice: false };
    await this.updateTenant(tenantId, { billingCycle: cycle });
    const open = await this.db.root.select().from(billingInvoices)
      .where(and(eq(billingInvoices.tenantId, tenantId), eq(billingInvoices.status, 'PENDING'), isNull(billingInvoices.submittedAt)));
    for (const inv of open) {
      await this.voidInvoice(inv.id);
      await this.createInvoice(tenantId, inv.periodStart);
    }
    return { billingCycle: cycle, replacedInvoice: open.length > 0 };
  }

  /** Company: "we've paid with <method>, reference <x>". Waits for the Super Admin to confirm. */
  async submitPayment(tenantId: string, invoiceId: string, paymentMethodId: string, reference: string) {
    const [m] = await this.db.root.select({ id: platformPaymentMethods.id }).from(platformPaymentMethods).where(and(eq(platformPaymentMethods.id, paymentMethodId), eq(platformPaymentMethods.isActive, true)));
    if (!m) throw badRequest('Choose one of the payment methods shown');
    const [row] = await this.db.root.update(billingInvoices)
      .set({ paymentMethodId, paymentReference: reference, submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(billingInvoices.id, invoiceId), eq(billingInvoices.tenantId, tenantId), eq(billingInvoices.status, 'PENDING')))
      .returning({ id: billingInvoices.id });
    if (!row) throw notFound('Invoice');
    return { id: invoiceId, submitted: true };
  }

  async invoices(tenantId: string) {
    return this.db.root.select().from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId)).orderBy(desc(billingInvoices.periodStart), desc(billingInvoices.createdAt));
  }

  async activeMethods() {
    return this.db.root.select().from(platformPaymentMethods).where(eq(platformPaymentMethods.isActive, true)).orderBy(asc(platformPaymentMethods.sortOrder), asc(platformPaymentMethods.name));
  }

  /** What a Company Admin sees on Billing: plan, prices for both cycles, status, invoices and how to pay. */
  /** Settles any open invoice of 0 (e.g. created before free plans were settled automatically). */
  private async settleFreeInvoices(tenantId: string) {
    const free = await this.db.root.select({ id: billingInvoices.id }).from(billingInvoices)
      .where(and(eq(billingInvoices.tenantId, tenantId), eq(billingInvoices.status, 'PENDING'), lte(billingInvoices.amount, 0)));
    for (const inv of free) await this.markPaid(inv.id, 'Free plan: no payment needed');
    return free.length;
  }

  async overview(tenantId: string) {
    await this.settleFreeInvoices(tenantId);
    const t = await this.tenant(tenantId);
    const plan = await this.plan(t.planId);
    const plans = await this.db.root.select().from(platformPlans).where(eq(platformPlans.isActive, true)).orderBy(asc(platformPlans.priceMonthly));
    return {
      billingCycle: t.billingCycle,
      billingStatus: t.billingStatus,
      paidUntil: t.paidUntil,
      plan: plan ? { id: plan.id, name: plan.name, currency: plan.currency, priceMonthly: plan.priceMonthly, priceAnnual: planPrice(plan, 'ANNUAL'), modules: plan.modules, maxEmployees: plan.maxEmployees } : null,
      plans: plans.map((p) => ({ id: p.id, name: p.name, description: p.description, currency: p.currency, priceMonthly: p.priceMonthly, priceAnnual: planPrice(p, 'ANNUAL'), modules: p.modules, maxEmployees: p.maxEmployees })),
      invoices: await this.invoices(tenantId),
      paymentMethods: await this.activeMethods(),
    };
  }

  /**
   * Daily cycle: when a company's paid period has ended, open the next invoice and mark it DUE; after the
   * grace period it becomes UNPAID (workspace locked to Billing until paid).
   */
  async runCycle() {
    const rows = await this.db.root.select().from(tenants)
      .where(and(eq(tenants.status, 'ACTIVE'), eq(tenants.isDemo, false), isNotNull(tenants.paidUntil), inArray(tenants.billingStatus, ['PAID', 'DUE'])));
    for (const t of rows) {
      await this.settleFreeInvoices(t.id).catch(() => 0);
      const today = todayIn(t.timezone);
      if (!t.paidUntil || t.paidUntil >= today) continue;
      try {
        const next = addDays(t.paidUntil, 1);
        const [existing] = await this.db.root.select({ id: billingInvoices.id }).from(billingInvoices)
          .where(and(eq(billingInvoices.tenantId, t.id), eq(billingInvoices.periodStart, next), ne(billingInvoices.status, 'VOID')));
        if (!existing && t.planId) await this.createInvoice(t.id, next);
        const locked = addDays(t.paidUntil, BILLING_GRACE_DAYS) < today;
        const status = locked ? 'UNPAID' : 'DUE';
        if (status !== t.billingStatus) await this.updateTenant(t.id, { billingStatus: status });
      } catch (e) {
        this.logger.error(`Billing cycle failed for ${t.slug}: ${(e as Error).message}`);
      }
    }
  }

  /** Companies whose paid period ended before `date` (for reports). */
  async overdue(date: string) {
    return this.db.root.select({ id: tenants.id, name: tenants.name, paidUntil: tenants.paidUntil }).from(tenants).where(lt(tenants.paidUntil, date));
  }
}
