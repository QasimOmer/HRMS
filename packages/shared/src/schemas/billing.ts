import { z } from 'zod';
import { password, phone, trimmed } from './common';

/** Subscription billing (Super Admin console, company Billing page, website sign-up). */
export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];
export const BILLING_STATUSES = ['PAID', 'DUE', 'UNPAID'] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];
/** Days a company keeps working after its period ends before the workspace is locked to Billing. */
export const BILLING_GRACE_DAYS = 7;

export const PAYMENT_METHOD_KINDS = ['BANK_TRANSFER', 'MOBILE_WALLET', 'CARD', 'CASH', 'OTHER'] as const;
export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHOD_KINDS)[number], string> = {
  BANK_TRANSFER: 'Bank transfer',
  MOBILE_WALLET: 'Mobile wallet (JazzCash, Easypaisa…)',
  CARD: 'Card',
  CASH: 'Cash / cheque',
  OTHER: 'Other',
};

export const paymentMethodSchema = z.object({
  name: trimmed(2, 80),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  instructions: trimmed(5, 2000),
  isActive: z.boolean().default(true),
});
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;

/** Company says it has paid an invoice (the Super Admin then confirms with "Mark paid"). */
export const submitPaymentSchema = z.object({
  paymentMethodId: z.uuid(),
  reference: trimmed(3, 120),
});

export const billingCycleSchema = z.object({ cycle: z.enum(BILLING_CYCLES) });

export const markPaidSchema = z.object({ note: z.string().trim().max(300).optional() });

/** Self-service sign-up from the website: company + Company Admin + chosen plan and cycle. */
export const signupSchema = z.object({
  companyName: trimmed(2, 120),
  adminName: trimmed(2, 120),
  email: z.email().toLowerCase(),
  phone: phone.optional(),
  password,
  planId: z.uuid(),
  cycle: z.enum(BILLING_CYCLES).default('MONTHLY'),
});
export type SignupInput = z.infer<typeof signupSchema>;

/** "Try the demo": who is looking (for marketing follow-up). */
export const demoRequestSchema = z.object({
  name: trimmed(2, 120),
  email: z.email().toLowerCase(),
  company: trimmed(2, 120),
  phone: phone.optional(),
});
export type DemoRequestInput = z.infer<typeof demoRequestSchema>;

/** Price for a plan and cycle; annual falls back to 12 × monthly when no annual price is set. */
export function planPrice(plan: { priceMonthly: number; priceAnnual?: number | null }, cycle: BillingCycle): number {
  return cycle === 'ANNUAL' ? (plan.priceAnnual ?? plan.priceMonthly * 12) : plan.priceMonthly;
}
