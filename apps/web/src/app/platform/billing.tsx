'use client';

import { DEFAULT_INVOICE_TEMPLATE, PAYMENT_METHOD_KINDS, PAYMENT_METHOD_LABELS, paymentMethodSchema, type BillingStatus, type InvoiceTemplate } from '@hrms/shared';
import { Ban, CheckCircle2, CreditCard, Pencil, Plus, ReceiptText, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { fieldError, useZodForm } from '@/lib/form';
import { date, dateTime, money } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { BillingStatusBadge, InvoiceStatusBadge } from '@/components/billing-status';
import { downloadCsv } from '@/lib/api';
import { InvoiceDialog, InvoiceView, type InvoiceDetail } from '@/components/invoice-view';
import { useBranding } from '@/lib/branding';


interface Invoice { id: string; number: string | null; title: string | null; kind: 'SUBSCRIPTION' | 'CUSTOM'; planName: string; cycle: 'MONTHLY' | 'ANNUAL'; amount: number; currency: string; periodStart: string; periodEnd: string; status: 'PENDING' | 'PAID' | 'VOID'; paymentReference: string | null; paymentMethodName: string | null; submittedAt: string | null; paidAt: string | null; note: string | null }

/** Company page: cycle, payment status and invoices, with Mark paid / Mark unpaid. */
export function CompanyBilling({ companyId, cycle, status, paidUntil, isDemo }: { companyId: string; cycle: 'MONTHLY' | 'ANNUAL'; status: BillingStatus; paidUntil: string | null; isDemo: boolean }) {
  const key = `/platform/companies/${companyId}/billing`;
  const inv = ['/platform/companies'];
  const { data: invoices, isLoading } = useApi<Invoice[]>(key);
  const { confirm, node } = useConfirm();
  const setCycle = useAction<'MONTHLY' | 'ANNUAL'>('patch', `/platform/companies/${companyId}`, { invalidate: inv, success: 'Billing cycle changed (applies from the next invoice)', body: (c) => ({ billingCycle: c }) });
  const setDemo = useAction<boolean>('patch', `/platform/companies/${companyId}`, { invalidate: inv, success: (r: unknown) => 'Demo setting saved', body: (d) => ({ isDemo: d }) });
  const create = useAction('post', `/platform/companies/${companyId}/invoices`, { invalidate: [key, ...inv], success: 'Invoice created for the next period', onSuccess: () => setNewOpen(false) });
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const paid = useAction<string>('post', (id) => `/platform/invoices/${id}/paid`, { invalidate: [key, ...inv], success: 'Marked paid. The workspace is unlocked.', body: () => ({}) });
  const unpaid = useAction<string | undefined>('post', `/platform/companies/${companyId}/unpaid`, { invalidate: [key, ...inv], success: 'Marked unpaid. The workspace is locked to Billing.', body: (invoiceId) => ({ invoiceId }) });
  const voidInv = useAction<string>('post', (id) => `/platform/invoices/${id}/void`, { invalidate: [key], success: 'Invoice cancelled', body: () => ({}) });

  return (
    <Card className="mt-6">
      <CardHeader title="Billing" description="Payments are confirmed by hand: when the money arrives, Mark paid. Unpaid companies can only open their Billing page."
        action={<BillingStatusBadge status={status} paidUntil={paidUntil} />} />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Billing cycle" className="w-48">{(a) => (
            <Select {...a} value={cycle} onChange={(e) => setCycle.mutate(e.target.value as 'MONTHLY' | 'ANNUAL')}>
              <option value="MONTHLY">Monthly</option>
              <option value="ANNUAL">Yearly</option>
            </Select>
          )}</Field>
          <Button variant="outline" onClick={() => setNewOpen(true)}><Plus className="h-4 w-4" /> New invoice</Button>
          {status !== 'UNPAID' && (
            <Button variant="outline" className="text-danger" loading={unpaid.isPending} onClick={async () => { if (await confirm({ title: 'Mark this company unpaid?', body: 'Their workspace is paused (only Billing works) until you mark an invoice paid.', danger: true, confirmLabel: 'Mark unpaid' })) unpaid.mutate(undefined); }}>
              <Ban className="h-4 w-4" /> Mark unpaid
            </Button>
          )}
          <span className="ml-auto"><Checkbox label="Public demo company (read-only)" checked={isDemo} onChange={(e) => setDemo.mutate(e.target.checked)} /></span>
        </div>
        <DataTable loading={isLoading} rows={invoices} rowKey={(i) => i.id} onRowClick={(i) => setOpenId(i.id)} empty="No invoices yet. Use New invoice to bill this company." columns={[
          { key: 'n', header: 'Invoice', cell: (i) => <div className="flex items-start gap-2"><ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="font-mono text-xs font-semibold">{i.number ?? '—'}</p><p className="truncate text-xs text-muted-foreground">{i.title ?? `${i.planName} subscription`}</p></div></div> },
          { key: 'p', header: 'Period', hideOnMobile: true, cell: (i) => (i.kind === 'CUSTOM' ? <Badge>custom</Badge> : <span className="text-xs">{date(i.periodStart)} – {date(i.periodEnd)}</span>) },
          { key: 'a', header: 'Amount', cell: (i) => <div><p className="tabular-nums">{money(i.amount, i.currency)}</p><p className="text-xs text-muted-foreground">{i.planName} · {i.cycle === 'ANNUAL' ? 'yearly' : 'monthly'}</p></div> },
          { key: 'r', header: 'Paid with', cell: (i) => (i.paymentReference ? <div className="text-xs"><p className="font-medium">{i.paymentMethodName ?? '—'}</p><p className="text-muted-foreground">Ref {i.paymentReference}{i.submittedAt ? ` · ${dateTime(i.submittedAt)}` : ''}</p></div> : <span className="text-xs text-muted-foreground">—</span>) },
          { key: 's', header: 'Status', cell: (i) => <InvoiceStatusBadge invoice={i} viewer="admin" /> },
          { key: 'x', header: <span className="sr-only">Actions</span>, cell: (i) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {i.status === 'PENDING' && <Button size="sm" loading={paid.isPending && paid.variables === i.id} onClick={() => paid.mutate(i.id)}><CheckCircle2 className="h-4 w-4" /> Mark paid</Button>}
              {i.status === 'PAID' && <Button size="sm" variant="outline" onClick={async () => { if (await confirm({ title: 'Mark this invoice unpaid?', body: 'Use this if the payment bounced or was refunded. The workspace is paused until it is paid.', danger: true, confirmLabel: 'Mark unpaid' })) unpaid.mutate(i.id); }}>Mark unpaid</Button>}
              {i.status === 'PENDING' && <Button size="icon" variant="ghost" aria-label="Cancel invoice" onClick={async () => { if (await confirm({ title: 'Cancel this invoice?', danger: true, confirmLabel: 'Cancel invoice' })) voidInv.mutate(i.id); }}><XCircle className="h-4 w-4 text-danger" /></Button>}
            </div>
          ) },
        ]} />
      </CardBody>
      {openId && <InvoiceDialog path={`/platform/invoices/${openId}`} pdfPath={`/platform/invoices/${openId}/pdf`} viewer="admin" onClose={() => setOpenId(null)}
        actions={(i) => (i.status === 'PENDING' ? <Button onClick={() => { paid.mutate(i.id); setOpenId(null); }}><CheckCircle2 className="h-4 w-4" /> Mark paid</Button> : null)} />}
      <NewInvoiceDialog open={newOpen} onOpenChange={setNewOpen} companyId={companyId} onSubscription={() => create.mutate(undefined)} subscriptionBusy={create.isPending} invalidate={[key, ...inv]} />
      {node}
    </Card>
  );
}

/** New invoice: the next subscription period, or a custom invoice the Super Admin writes (what it's for + lines). */
function NewInvoiceDialog({ open, onOpenChange, companyId, onSubscription, subscriptionBusy, invalidate }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string; onSubscription: () => void; subscriptionBusy: boolean; invalidate: string[] }) {
  const [mode, setMode] = useState<'SUBSCRIPTION' | 'CUSTOM'>('CUSTOM');
  const [title, setTitle] = useState('');
  const [items, setItems] = useState([{ description: '', quantity: '1', unitPrice: '' }]);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  useEffect(() => {
    if (!open) return;
    setTitle(''); setItems([{ description: '', quantity: '1', unitPrice: '' }]); setDueDate(''); setNotes('');
  }, [open]);
  const lines = items.map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0 }));
  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const valid = title.trim().length >= 3 && lines.length > 0 && lines.every((l) => l.description.length >= 2 && l.quantity > 0);
  const create = useAction('post', `/platform/companies/${companyId}/invoices/custom`, {
    invalidate, success: 'Invoice created. The company can see it on its Billing page.', onSuccess: () => onOpenChange(false),
    body: () => ({ title: title.trim(), items: lines, ...(dueDate ? { dueDate } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) }),
  });
  const setItem = (k: number, patch: Partial<(typeof items)[number]>) => setItems((x) => x.map((it, i) => (i === k ? { ...it, ...patch } : it)));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New invoice" size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>{mode === 'SUBSCRIPTION'
        ? <Button loading={subscriptionBusy} onClick={onSubscription}>Create subscription invoice</Button>
        : <Button loading={create.isPending} disabled={!valid} onClick={() => create.mutate(undefined)}>Create invoice</Button>}</>}>
      <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-2">
          {([['CUSTOM', 'Custom invoice', 'Setup, training, extra services… you write the lines.'], ['SUBSCRIPTION', 'Next subscription period', 'The plan price for the next monthly or yearly period.']] as const).map(([m, label, hint]) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`rounded-lg border p-3 text-left text-sm transition ${mode === m ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'hover:bg-muted'}`}>
              <p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{hint}</p>
            </button>
          ))}
        </div>
        {mode === 'CUSTOM' && (
          <>
            <Field label="What is this invoice for?" required hint="Shown as the invoice heading, e.g. Onboarding and data import">{(a) => <Input {...a} maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <div>
              <p className="mb-2 text-sm font-medium">Lines</p>
              <div className="space-y-2">
                {items.map((it, k) => (
                  <div key={k} className="grid grid-cols-[1fr_5rem_8rem_auto] items-center gap-2">
                    <Input aria-label="Description" placeholder="Description" value={it.description} onChange={(e) => setItem(k, { description: e.target.value })} />
                    <Input aria-label="Quantity" type="number" min={1} value={it.quantity} onChange={(e) => setItem(k, { quantity: e.target.value })} />
                    <Input aria-label="Unit price" type="number" min={0} placeholder="Price" value={it.unitPrice} onChange={(e) => setItem(k, { unitPrice: e.target.value })} />
                    <Button size="icon" variant="ghost" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems((x) => x.filter((_, i) => i !== k))}><XCircle className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <Button size="sm" variant="outline" onClick={() => setItems((x) => [...x, { description: '', quantity: '1', unitPrice: '' }])}><Plus className="h-4 w-4" /> Add line</Button>
                <p className="text-sm">Total <span className="ml-2 text-lg font-semibold tabular-nums">{total.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span></p>
              </div>
            </div>
            <FormGrid>
              <Field label="Due date" hint="Empty = the payment terms from your invoice settings">{(a) => <Input {...a} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
            </FormGrid>
            <Field label="Notes" hint="Printed on the invoice">{(a) => <Textarea {...a} rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Platform settings → Invoices: who invoices are from and how they look, with a live preview. */
export function InvoiceTemplateSettings() {
  const { data } = useApi<InvoiceTemplate>('/platform/settings/invoice-template');
  const { logoUrl } = useBranding();
  const [t, setT] = useState<InvoiceTemplate>(DEFAULT_INVOICE_TEMPLATE);
  useEffect(() => { if (data) setT(data); }, [data]);
  const save = useAction('put', '/platform/settings/invoice-template', { invalidate: ['/platform/settings/invoice-template'], success: 'Invoice settings saved', body: () => t });
  const set = (patch: Partial<InvoiceTemplate>) => setT((x) => ({ ...x, ...patch }));
  const sample: InvoiceDetail = {
    id: 'sample', number: 'INV-2026-00042', kind: 'SUBSCRIPTION', title: 'Professional subscription (monthly)', planName: 'Professional',
    items: [{ description: 'Professional plan, monthly', quantity: 1, unitPrice: 35000 }], amount: 35000, currency: 'PKR',
    periodStart: '2026-11-01', periodEnd: '2026-11-30', dueDate: '2026-11-08', status: 'PENDING', submittedAt: null, paidAt: null,
    paymentReference: null, note: null, createdAt: '2026-11-01T00:00:00Z', company: { name: 'Acme Pvt Ltd', workspace: 'acme', emailDomain: 'acme.com' },
  };
  return (
    <Card>
      <CardHeader title="Invoices" description="Your business details and style on every invoice. The platform logo (General tab) is used when shown." />
      <CardBody className="grid gap-8 xl:grid-cols-2">
        <div className="space-y-4">
          <FormGrid>
            <Field label="Business name" hint="Who the invoice is from">{(a) => <Input {...a} maxLength={120} value={t.businessName} onChange={(e) => set({ businessName: e.target.value })} />}</Field>
            <Field label="Phone">{(a) => <Input {...a} maxLength={40} value={t.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
            <Field label="Email">{(a) => <Input {...a} type="email" maxLength={120} value={t.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
            <Field label="Website">{(a) => <Input {...a} maxLength={120} value={t.website} onChange={(e) => set({ website: e.target.value })} />}</Field>
            <Field label="Tax / registration no.">{(a) => <Input {...a} maxLength={60} value={t.taxId} onChange={(e) => set({ taxId: e.target.value })} />}</Field>
            <Field label="Payment due after (days)">{(a) => <Input {...a} type="number" min={0} max={120} value={t.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: Math.max(0, Math.min(120, Number(e.target.value) || 0)) })} />}</Field>
          </FormGrid>
          <Field label="Address">{(a) => <Textarea {...a} rows={2} maxLength={300} value={t.address} onChange={(e) => set({ address: e.target.value })} />}</Field>
          <Field label="Colour">{(a) => (
            <div className="flex flex-wrap items-center gap-2">
              {['#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#0f172a'].map((c) => <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => set({ accentColor: c })} className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-card ${t.accentColor === c ? 'ring-2 ring-foreground' : ''}`} style={{ background: c }} />)}
              <input {...a} type="color" value={t.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="h-8 w-12 cursor-pointer rounded border bg-transparent" />
            </div>
          )}</Field>
          <Checkbox label="Show the platform logo" checked={t.showLogo} onChange={(e) => set({ showLogo: e.target.checked })} />
          <Field label="Footer" hint="Thank-you note, bank details, terms… printed at the bottom">{(a) => <Textarea {...a} rows={3} maxLength={600} value={t.footerNote} onChange={(e) => set({ footerNote: e.target.value })} />}</Field>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save invoice settings</Button>
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</p>
          <InvoiceView invoice={sample} template={t} logoUrl={logoUrl} viewer="admin" />
        </div>
      </CardBody>
    </Card>
  );
}

interface Method { id: string; name: string; kind: (typeof PAYMENT_METHOD_KINDS)[number]; instructions: string; isActive: boolean }

/** Platform settings → Payment methods: how companies can pay, with the details they see. */
export function PaymentMethods() {
  const { data, isLoading } = useApi<Method[]>('/platform/payment-methods');
  const [edit, setEdit] = useState<{ open: boolean; m?: Method }>({ open: false });
  const form = useZodForm(paymentMethodSchema);
  useEffect(() => {
    if (edit.open) form.reset(edit.m ? { name: edit.m.name, kind: edit.m.kind, instructions: edit.m.instructions, isActive: edit.m.isActive } : { name: '', kind: 'BANK_TRANSFER', instructions: '', isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);
  const done = { invalidate: ['/platform/payment-methods'], success: 'Payment method saved', onSuccess: () => setEdit({ open: false }) };
  const create = useAction('post', '/platform/payment-methods', done);
  const update = useAction('put', () => `/platform/payment-methods/${edit.m!.id}`, done);
  const del = useAction<string>('del', (id) => `/platform/payment-methods/${id}`, { invalidate: ['/platform/payment-methods'], success: 'Payment method removed' });
  const { confirm, node } = useConfirm();
  return (
    <Card>
      <CardHeader title="Payment methods" description="Shown to companies when they pay an invoice. There's no card gateway yet: companies pay with one of these and you confirm with Mark paid."
        action={<Button size="sm" onClick={() => setEdit({ open: true })}><Plus className="h-4 w-4" /> Add method</Button>} />
      {!isLoading && !data?.length ? (
        <EmptyState icon={CreditCard} title="No payment methods yet" description="Add your bank account or mobile wallet so companies know how to pay." />
      ) : (
        <DataTable loading={isLoading} rows={data} rowKey={(m) => m.id} onRowClick={(m) => setEdit({ open: true, m })} columns={[
          { key: 'n', header: 'Method', cell: (m) => <div><p className="font-medium">{m.name} {!m.isActive && <Badge>hidden</Badge>}</p><p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[m.kind]}</p></div> },
          { key: 'i', header: 'Details shown to companies', cell: (m) => <p className="line-clamp-2 max-w-md text-xs whitespace-pre-line text-muted-foreground">{m.instructions}</p> },
          { key: 'a', header: <span className="sr-only">Actions</span>, cell: (m) => (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="icon" variant="ghost" aria-label={`Edit ${m.name}`} onClick={() => setEdit({ open: true, m })}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" aria-label={`Remove ${m.name}`} className="text-danger" onClick={async () => { if (await confirm({ title: `Remove ${m.name}?`, danger: true, confirmLabel: 'Remove' })) del.mutate(m.id); }}><XCircle className="h-4 w-4" /></Button>
            </div>
          ) },
        ]} />
      )}
      <Dialog open={edit.open} onOpenChange={(o) => setEdit({ open: o, m: edit.m })} title={edit.m ? `Edit ${edit.m.name}` : 'Add payment method'}
        footer={<><Button variant="outline" onClick={() => setEdit({ open: false })}>Cancel</Button><Button loading={create.isPending || update.isPending} onClick={form.handleSubmit((v) => (edit.m ? update.mutate(v) : create.mutate(v)))}>Save</Button></>}>
        <div className="space-y-4">
          <FormGrid>
            <Field label="Name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} placeholder="e.g. Meezan Bank" {...form.register('name')} />}</Field>
            <Field label="Type" error={fieldError(form, 'kind')}>{(a) => <Select {...a} {...form.register('kind')}>{PAYMENT_METHOD_KINDS.map((k) => <option key={k} value={k}>{PAYMENT_METHOD_LABELS[k]}</option>)}</Select>}</Field>
          </FormGrid>
          <Field label="Payment details" required hint="Account title, account number / IBAN, wallet number… exactly as companies should use them." error={fieldError(form, 'instructions')}>
            {(a) => <Textarea {...a} rows={5} placeholder={'Account title: Your Company Pvt Ltd\nIBAN: PK00 XXXX 0000 0000 0000 0000\nBranch: Gulberg, Lahore'} {...form.register('instructions')} />}
          </Field>
          <Checkbox label="Show to companies" {...form.register('isActive')} />
        </div>
      </Dialog>
      {node}
    </Card>
  );
}

interface Lead { id: string; email: string; name: string | null; company: string | null; phone: string | null; source: 'DEMO' | 'SIGNUP'; createdAt: string }

/** Marketing: who tried the demo or signed up from the website. */
export function Leads() {
  const { data, isLoading } = useApi<Lead[]>('/platform/leads');
  const [filter, setFilter] = useState<'' | 'DEMO' | 'SIGNUP'>('');
  const rows = (data ?? []).filter((l) => !filter || l.source === filter);
  const csv = () => downloadCsv('hrms-leads.csv', [
    ['Date', 'Source', 'Name', 'Email', 'Company', 'Phone'],
    ...rows.map((l) => [l.createdAt, l.source === 'SIGNUP' ? 'Signed up' : 'Tried demo', l.name, l.email, l.company, l.phone]),
  ]);
  return (
    <Card>
      <CardHeader title="Leads" description="People who tried the demo or signed up on the website."
        action={<div className="flex gap-2"><Select aria-label="Source" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="">All</option><option value="DEMO">Demo</option><option value="SIGNUP">Sign-up</option></Select><Button size="sm" variant="outline" disabled={!rows.length} onClick={csv}>Export CSV</Button></div>} />
      <DataTable loading={isLoading} rows={rows} rowKey={(l) => l.id} empty="No leads yet" columns={[
        { key: 'n', header: 'Name', cell: (l) => <div><p className="font-medium">{l.name ?? '—'}</p><p className="text-xs text-muted-foreground">{l.email}</p></div> },
        { key: 'c', header: 'Company', cell: (l) => l.company ?? '—' },
        { key: 'p', header: 'Phone', hideOnMobile: true, cell: (l) => l.phone ?? '—' },
        { key: 's', header: 'Source', cell: (l) => <Badge tone={l.source === 'SIGNUP' ? 'success' : 'info'}>{l.source === 'SIGNUP' ? 'Signed up' : 'Tried demo'}</Badge> },
        { key: 'd', header: 'When', hideOnMobile: true, cell: (l) => dateTime(l.createdAt) },
      ]} />
    </Card>
  );
}

/** Super Admin home: the newest demo visitors and sign-ups at a glance. */
export function RecentLeads() {
  const { data } = useApi<Lead[]>('/platform/leads', { fresh: true });
  if (!data?.length) return null;
  const week = data.filter((l) => Date.now() - new Date(l.createdAt).getTime() < 7 * 864e5).length;
  return (
    <Card className="mb-6">
      <CardHeader title="Demo requests and sign-ups" description={`${week} in the last 7 days · ${data.length} in total`}
        action={<Link href="/platform/leads" className="text-sm font-medium text-primary hover:underline">View all leads</Link>} />
      <ul className="divide-y">
        {data.slice(0, 5).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{l.name ?? l.email}</span>
              <a href={`mailto:${l.email}`} className="ml-2 text-muted-foreground hover:text-primary">{l.email}</a>
              {l.company && <span className="text-muted-foreground"> · {l.company}</span>}
            </span>
            <Badge tone={l.source === 'SIGNUP' ? 'success' : 'info'}>{l.source === 'SIGNUP' ? 'Signed up' : 'Tried demo'}</Badge>
            <span className="text-xs text-muted-foreground">{dateTime(l.createdAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
