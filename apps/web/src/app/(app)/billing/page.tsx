'use client';

import { MODULE_INFO, PAYMENT_METHOD_LABELS, type Module } from '@hrms/shared';
import { AlertTriangle, Check, CheckCircle2, Clock, Copy, CreditCard, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@/components/ui/display';
import { Field, Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { cn, date, money } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { BillingStatusBadge, InvoiceStatusBadge } from '@/components/billing-status';
import { InvoiceDialog } from '@/components/invoice-view';

interface PlanInfo { id: string; name: string; description?: string | null; currency: string; priceMonthly: number; priceAnnual: number; modules: Module[]; maxEmployees: number | null }
interface Invoice { id: string; number: string | null; title: string | null; kind: 'SUBSCRIPTION' | 'CUSTOM'; planName: string; cycle: 'MONTHLY' | 'ANNUAL'; amount: number; currency: string; periodStart: string; periodEnd: string; status: 'PENDING' | 'PAID' | 'VOID'; paymentReference: string | null; submittedAt: string | null; paidAt: string | null }
interface Method { id: string; name: string; kind: keyof typeof PAYMENT_METHOD_LABELS; instructions: string }
interface Overview { billingCycle: 'MONTHLY' | 'ANNUAL'; billingStatus: 'PAID' | 'DUE' | 'UNPAID'; paidUntil: string | null; plan: PlanInfo | null; plans: PlanInfo[]; invoices: Invoice[]; paymentMethods: Method[] }

const STATUS: Record<Overview['billingStatus'], { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  PAID: { label: 'Paid', tone: 'success' },
  DUE: { label: 'Payment due', tone: 'warning' },
  UNPAID: { label: 'Unpaid – workspace paused', tone: 'danger' },
};

function PayDialog({ invoice, methods, onClose }: { invoice: Invoice | null; methods: Method[]; onClose: () => void }) {
  const [methodId, setMethodId] = useState('');
  const [reference, setReference] = useState('');
  const method = methods.find((m) => m.id === methodId);
  const submit = useAction('post', () => `/billing/invoices/${invoice!.id}/submit`, {
    invalidate: ['/billing'],
    success: 'Thanks! We will confirm your payment shortly.',
    body: () => ({ paymentMethodId: methodId, reference: reference.trim() }),
    onSuccess: () => { setMethodId(''); setReference(''); onClose(); },
  });
  if (!invoice) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Pay ${money(invoice.amount, invoice.currency)}`} description={`${invoice.planName} · ${invoice.cycle === 'ANNUAL' ? 'yearly' : 'monthly'} · ${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`} size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={submit.isPending} disabled={!methodId || reference.trim().length < 3} onClick={() => submit.mutate(undefined)}>I've paid</Button></>}>
      {methods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payment methods are set up yet. Please contact us to pay.</p>
      ) : (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium">1. Choose how you'll pay</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {methods.map((m) => (
                <button key={m.id} type="button" onClick={() => setMethodId(m.id)} aria-pressed={methodId === m.id}
                  className={cn('rounded-lg border p-3 text-left text-sm transition', methodId === m.id ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'hover:bg-muted')}>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[m.kind]}</p>
                </button>
              ))}
            </div>
          </div>
          {method && (
            <div>
              <p className="mb-2 text-sm font-medium">2. Send {money(invoice.amount, invoice.currency)} using these details</p>
              <div className="relative rounded-lg border bg-muted/40 p-4">
                <pre className="font-sans text-sm whitespace-pre-wrap">{method.instructions}</pre>
                <Button size="icon" variant="ghost" className="absolute top-2 right-2" aria-label="Copy payment details" onClick={() => navigator.clipboard.writeText(method.instructions).then(() => toast.success('Copied'))}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
          {method && (
            <Field label="3. Transaction ID / reference" required hint="From your bank or wallet receipt, so we can match your payment.">{(a) => <Input {...a} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />}</Field>
          )}
        </div>
      )}
    </Dialog>
  );
}

/** Company Admin: subscription plan, prices for both cycles, invoices and paying them. */
export default function BillingPage() {
  const { me, refresh } = useAuth();
  const { data, isLoading } = useApi<Overview>('/billing');
  // Billing can settle on its own (e.g. a free plan): reload the session so the lock lifts right away.
  useEffect(() => {
    if (data && me && data.billingStatus !== me.tenant.billingStatus) void refresh();
  }, [data, me, refresh]);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const changeCycle = useAction<'MONTHLY' | 'ANNUAL', { billingCycle: string; replacedInvoice: boolean }>('post', '/billing/cycle', {
    invalidate: ['/billing'],
    body: (cycle) => ({ cycle }),
    success: (r) => `Switched to ${r.billingCycle === 'ANNUAL' ? 'yearly' : 'monthly'} billing.${r.replacedInvoice ? ' Your open invoice was updated to the new price.' : ' It applies from your next invoice.'}`,
  });
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const open = data.invoices.filter((i) => i.status === 'PENDING');
  return (
    <>
      <PageHeader title="Billing & plan" description={`Subscription for ${me?.tenant.name}.`} />

      {data.billingStatus !== 'PAID' && (
        <div role="alert" className={cn('mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', data.billingStatus === 'UNPAID' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warning/30 bg-warning-soft text-warning')}>
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">{data.billingStatus === 'UNPAID' ? 'Your workspace is paused until the payment is confirmed.' : 'Your next payment is due.'}</p>
            <p className="mt-0.5">Pay the open invoice below, then enter the transaction reference. {data.billingStatus === 'UNPAID' ? 'Everyone gets access again as soon as we confirm it.' : ''}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Current plan" action={<BillingStatusBadge status={data.billingStatus} />} />
          <CardBody>
            {data.plan ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="text-2xl font-semibold">{data.plan.name}</p>
                    <p className="text-sm text-muted-foreground">Billed {data.billingCycle === 'ANNUAL' ? 'yearly' : 'monthly'}{data.paidUntil ? ` · paid until ${date(data.paidUntil)}` : ''}</p>
                  </div>
                  <div className="flex gap-3">
                    {(['MONTHLY', 'ANNUAL'] as const).map((c) => {
                      const on = data.billingCycle === c;
                      return (
                        <button key={c} type="button" aria-pressed={on} disabled={changeCycle.isPending}
                          onClick={() => !on && changeCycle.mutate(c)}
                          title={on ? 'Your current billing' : `Switch to ${c === 'ANNUAL' ? 'yearly' : 'monthly'} billing`}
                          className={cn('rounded-lg border px-3 py-2 text-right transition', on ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'hover:border-primary/60 hover:bg-muted', changeCycle.isPending && 'opacity-60')}>
                          <p className="text-xs text-muted-foreground">{c === 'ANNUAL' ? 'Yearly' : 'Monthly'}{on ? ' · current' : ''}</p>
                          <p className="font-semibold tabular-nums">{money(c === 'ANNUAL' ? data.plan!.priceAnnual : data.plan!.priceMonthly, data.plan!.currency)}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge>{data.plan.maxEmployees ? `Up to ${data.plan.maxEmployees} employees` : 'Unlimited employees'}</Badge>
                  {data.plan.modules.map((m) => <Badge key={m} tone="primary">{MODULE_INFO[m].label}</Badge>)}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Your company has a custom set of modules. Contact us about pricing.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Payment" />
          <CardBody className="space-y-3">
            {open.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nothing to pay right now.</p>
            ) : (
              open.map((i) => (
                <div key={i.id} className="rounded-lg border p-3">
                  <p className="text-lg font-semibold tabular-nums">{money(i.amount, i.currency)}</p>
                  <p className="text-xs text-muted-foreground">{date(i.periodStart)} – {date(i.periodEnd)}</p>
                  {i.submittedAt ? (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-warning"><Clock className="h-3.5 w-3.5" /> Reference {i.paymentReference} sent – waiting for confirmation</p>
                  ) : null}
                  <Button size="sm" className="mt-3 w-full" variant={i.submittedAt ? 'outline' : 'primary'} onClick={() => setPaying(i)}><CreditCard className="h-4 w-4" /> {i.submittedAt ? 'Update payment details' : 'Pay now'}</Button>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Plans" description="Prices for every plan. Switch between monthly and yearly above. To change plan, contact us; it applies from your next invoice." />
        <CardBody className="grid gap-4 md:grid-cols-3">
          {data.plans.map((p) => {
            const current = p.id === data.plan?.id;
            const saving = p.priceMonthly * 12 - p.priceAnnual;
            return (
              <div key={p.id} className={cn('rounded-xl border p-4', current && 'border-primary ring-1 ring-primary')}>
                <div className="flex items-center justify-between"><p className="font-semibold">{p.name}</p>{current && <Badge tone="primary">Current</Badge>}</div>
                <p className="mt-2 text-xl font-semibold tabular-nums">{money(p.priceMonthly, p.currency)}<span className="text-sm font-normal text-muted-foreground"> / month</span></p>
                <p className="text-sm text-muted-foreground">or {money(p.priceAnnual, p.currency)} / year{saving > 0 ? ` (save ${money(saving, p.currency)})` : ''}</p>
                <ul className="mt-3 space-y-1 text-xs">
                  {p.modules.map((m) => <li key={m} className="flex gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> {MODULE_INFO[m].label}</li>)}
                </ul>
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Invoices" description="Click an invoice to see what it is for or download it as a PDF." />
        <DataTable rows={data.invoices} rowKey={(i) => i.id} onRowClick={(i) => setOpenId(i.id)} empty="No invoices yet" columns={[
          { key: 'n', header: 'Invoice', cell: (i) => <div className="flex items-start gap-2"><Receipt className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="font-mono text-xs font-semibold">{i.number ?? '—'}</p><p className="truncate text-xs text-muted-foreground">{i.title ?? `${i.planName} subscription`}</p></div></div> },
          { key: 'p', header: 'Period', hideOnMobile: true, cell: (i) => (i.kind === 'CUSTOM' ? '—' : `${date(i.periodStart)} – ${date(i.periodEnd)}`) },
          { key: 'a', header: 'Amount', cell: (i) => <span className="tabular-nums">{money(i.amount, i.currency)}</span> },
          { key: 's', header: 'Status', cell: (i) => <InvoiceStatusBadge invoice={i} viewer="company" /> },
        ]} />
      </Card>

      <PayDialog invoice={paying} methods={data.paymentMethods} onClose={() => setPaying(null)} />
      {openId && (
        <InvoiceDialog path={`/billing/invoices/${openId}`} pdfPath={`/billing/invoices/${openId}/pdf`} viewer="company" onClose={() => setOpenId(null)}
          actions={(i) => (i.status === 'PENDING' ? <Button onClick={() => { setOpenId(null); setPaying(data.invoices.find((x) => x.id === i.id) ?? null); }}><CreditCard className="h-4 w-4" /> {i.submittedAt ? 'Update payment' : 'Pay now'}</Button> : null)} />
      )}
    </>
  );
}
