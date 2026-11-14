import type { BillingStatus } from '@hrms/shared';
import { Badge } from '@/components/ui/display';
import { date } from '@/lib/format';

/** One wording and colour for subscription status, used by the company Billing page and the Super Admin console. */
export const BILLING_STATUS: Record<BillingStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  PAID: { label: 'Paid', tone: 'success' },
  DUE: { label: 'Payment due', tone: 'warning' },
  UNPAID: { label: 'Unpaid', tone: 'danger' },
};

export function BillingStatusBadge({ status, paidUntil }: { status: BillingStatus; paidUntil?: string | null }) {
  const s = BILLING_STATUS[status];
  return <Badge tone={s.tone}>{s.label}{paidUntil ? ` · until ${date(paidUntil)}` : ''}</Badge>;
}

interface InvoiceLike { status: 'PENDING' | 'PAID' | 'VOID'; submittedAt: string | null; paidAt: string | null }

/**
 * Invoice status. A pending invoice the company has already paid (reference sent) reads "Awaiting
 * confirmation" for the company and "Check payment" for the Super Admin, who confirms it.
 */
export function InvoiceStatusBadge({ invoice: i, viewer }: { invoice: InvoiceLike; viewer: 'company' | 'admin' }) {
  if (i.status === 'PAID') return <Badge tone="success">Paid{i.paidAt ? ` ${date(i.paidAt)}` : ''}</Badge>;
  if (i.status === 'VOID') return <Badge tone="neutral">Cancelled</Badge>;
  if (i.submittedAt) return <Badge tone="info">{viewer === 'admin' ? 'Check payment' : 'Awaiting confirmation'}</Badge>;
  return <Badge tone="warning">Unpaid</Badge>;
}
