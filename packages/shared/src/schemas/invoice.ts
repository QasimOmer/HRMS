import { z } from 'zod';
import { isoDate, trimmed } from './common';

/**
 * How subscription invoices look and who they're from. Set by the Super Admin (Platform settings →
 * Invoices); every company's invoices use it. The platform logo is used when `showLogo` is on.
 */
export const invoiceTemplateSchema = z.object({
  businessName: z.string().trim().max(120),
  address: z.string().trim().max(300),
  phone: z.string().trim().max(40),
  email: z.union([z.literal(''), z.email()]),
  website: z.string().trim().max(120),
  /** Tax / registration number (NTN, VAT…), printed under the address. */
  taxId: z.string().trim().max(60),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8'),
  showLogo: z.boolean(),
  /** Days after the invoice date the payment is due. */
  paymentTermsDays: z.coerce.number().int().min(0).max(120),
  /** Printed at the bottom: thank-you note, bank details, terms… */
  footerNote: z.string().trim().max(600),
});
export type InvoiceTemplate = z.infer<typeof invoiceTemplateSchema>;

export const DEFAULT_INVOICE_TEMPLATE: InvoiceTemplate = {
  businessName: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  taxId: '',
  accentColor: '#1d4ed8',
  showLogo: true,
  paymentTermsDays: 7,
  footerNote: 'Thank you for your business. Please quote the invoice number with your payment.',
};

export function invoiceTemplate(saved?: Partial<InvoiceTemplate> | null): InvoiceTemplate {
  return { ...DEFAULT_INVOICE_TEMPLATE, ...(saved ?? {}) };
}

export const invoiceItemSchema = z.object({
  description: trimmed(2, 200),
  quantity: z.coerce.number().positive().max(100000),
  unitPrice: z.coerce.number().min(0).max(1_000_000_000),
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

/** Super Admin creates an invoice by hand: what it's for, the lines, and when it's due. */
export const customInvoiceSchema = z.object({
  title: trimmed(3, 150),
  items: z.array(invoiceItemSchema).min(1, 'Add at least one line').max(50),
  dueDate: isoDate.optional(),
  notes: z.string().trim().max(1000).optional().transform((v) => v || undefined),
});
export type CustomInvoiceInput = z.infer<typeof customInvoiceSchema>;

export const invoiceTotal = (items: { quantity: number; unitPrice: number }[]) =>
  Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) * 100) / 100;
