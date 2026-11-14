'use client';

import { invoiceTotal, type InvoiceTemplate } from '@hrms/shared';
import { Download } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { InvoiceStatusBadge } from '@/components/billing-status';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/overlay';
import { downloadFile } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export interface InvoiceDetail {
  id: string;
  number: string | null;
  kind: 'SUBSCRIPTION' | 'CUSTOM';
  title: string | null;
  planName: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  amount: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  status: 'PENDING' | 'PAID' | 'VOID';
  submittedAt: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  paymentMethodName?: string | null;
  note: string | null;
  createdAt: string;
  company?: { name: string; workspace: string; emailDomain: string | null };
}

/**
 * An invoice on screen: who it's from (when a template is given), who it's for, what it's for, the lines
 * and the total. The PDF (Download) is the official copy, styled by the Super Admin's invoice template.
 */
export function InvoiceView({ invoice: i, template, logoUrl, viewer }: { invoice: InvoiceDetail; template?: InvoiceTemplate; logoUrl?: string | null; viewer: 'company' | 'admin' }) {
  const items = i.items.length ? i.items : [{ description: i.title ?? i.planName, quantity: 1, unitPrice: i.amount }];
  const accent = template?.accentColor ?? 'var(--primary)';
  return (
    <div className="overflow-hidden rounded-xl border bg-white text-sm text-slate-800 shadow-sm">
      <div className="h-2" style={{ background: accent }} />
      <div className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            {template?.showLogo && logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-12 w-12 shrink-0 object-contain" />
            )}
            {template && (
              <div className="min-w-0 text-xs text-slate-500">
                <p className="text-base font-semibold text-slate-900">{template.businessName || 'Your business name'}</p>
                {template.address && <p className="whitespace-pre-line">{template.address}</p>}
                {(template.phone || template.email) && <p>{[template.phone, template.email].filter(Boolean).join(' · ')}</p>}
                {template.website && <p>{template.website}</p>}
                {template.taxId && <p>Tax / Reg. no: {template.taxId}</p>}
              </div>
            )}
          </div>
          <div className="ml-auto text-right">
            <p className="text-2xl font-bold tracking-tight" style={{ color: accent }}>INVOICE</p>
            <p className="font-mono text-xs font-semibold text-slate-700">{i.number ?? '—'}</p>
            <div className="mt-1"><InvoiceStatusBadge invoice={i} viewer={viewer} /></div>
          </div>
        </div>

        <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Bill to</p>
            <p className="font-semibold text-slate-900">{i.company?.name ?? '—'}</p>
            {i.company && <p className="text-xs text-slate-500">Workspace: {i.company.workspace}{i.company.emailDomain ? ` · ${i.company.emailDomain}` : ''}</p>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs sm:justify-self-end">
            <dt className="text-slate-500">Invoice date</dt><dd className="text-right font-medium">{date(i.createdAt)}</dd>
            <dt className="text-slate-500">Due date</dt><dd className="text-right font-medium">{i.dueDate ? date(i.dueDate) : 'On receipt'}</dd>
            {i.kind === 'SUBSCRIPTION' && <><dt className="text-slate-500">Period</dt><dd className="text-right font-medium">{date(i.periodStart)} – {date(i.periodEnd)}</dd></>}
          </dl>
        </div>

        <div>
          <p className="mb-2 text-base font-semibold text-slate-900">{i.title ?? `${i.planName} subscription`}</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-xs">
              <thead>
                <tr className="text-left text-white" style={{ background: accent }}>
                  <th className="px-3 py-2 font-semibold">Description</th>
                  <th className="px-3 py-2 text-right font-semibold">Qty</th>
                  <th className="px-3 py-2 text-right font-semibold">Unit price</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, k) => (
                  <tr key={k} className="border-b border-slate-100 even:bg-slate-50">
                    <td className="px-3 py-2">{it.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(it.unitPrice, i.currency)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(it.quantity * it.unitPrice, i.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <div className="flex min-w-56 items-center justify-between gap-6 rounded-lg bg-slate-100 px-4 py-2.5">
              <span className="text-slate-500">Total</span>
              <span className="text-base font-bold tabular-nums text-slate-900">{money(items.length ? invoiceTotal(items) : i.amount, i.currency)}</span>
            </div>
          </div>
        </div>

        {(i.paymentReference || i.paidAt) && (
          <p className="text-xs text-slate-600">
            {i.status === 'PAID' ? <span className="font-semibold text-green-700">Paid{i.paidAt ? ` on ${date(i.paidAt)}` : ''}</span> : <span className="font-semibold text-sky-700">Payment sent, awaiting confirmation</span>}
            {i.paymentMethodName ? ` · ${i.paymentMethodName}` : ''}{i.paymentReference ? ` · Ref ${i.paymentReference}` : ''}
          </p>
        )}
        {i.kind === 'CUSTOM' && i.note && (
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Notes</p>
            <p className="whitespace-pre-line text-xs">{i.note}</p>
          </div>
        )}
        {template?.footerNote && <p className="border-t pt-3 text-center text-xs text-slate-500 whitespace-pre-line">{template.footerNote}</p>}
      </div>
    </div>
  );
}

/** Opens an invoice by id: details on screen, Download PDF, plus any extra actions (pay, mark paid…). */
export function InvoiceDialog({ path, pdfPath, viewer, onClose, actions }: { path: string; pdfPath: string; viewer: 'company' | 'admin'; onClose: () => void; actions?: (i: InvoiceDetail) => ReactNode }) {
  const { data } = useApi<InvoiceDetail>(path);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    if (!data) return;
    setBusy(true);
    try {
      await downloadFile(pdfPath, `${data.number ?? 'invoice'}.pdf`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={data ? `Invoice ${data.number ?? ''}` : 'Invoice'} size="lg"
      footer={<>{data && actions?.(data)}<Button variant="outline" loading={busy} disabled={!data} onClick={download}><Download className="h-4 w-4" /> Download PDF</Button></>}>
      {data ? <InvoiceView invoice={data} viewer={viewer} /> : <Skeleton className="h-96" />}
    </Dialog>
  );
}
