'use client';

import { PERMISSIONS as P, loanSchema } from '@hrms/shared';
import { HandCoins, Paperclip, Plus, Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DecisionButtons, EmployeeSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Progress, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { FileUpload } from '@/components/ui/file-upload';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { date, money, monthLabel, todayLocal } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';

interface Loan { id: string; employeeId: string; fullName: string; principal: number; installment: number; startPeriod: string; reason: string | null; status: string; fileIds: string[]; requestedByEmployee: boolean; repaid: number; outstanding: number; createdAt: string }
interface Repayment { id: string; amount: number; paidOn: string; source: string; note: string | null }

/** LON-04: an employee asks for a loan from their portal; HR approves or rejects it. */
function RequestLoanDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const blank = { principal: '', installment: '', startPeriod: todayLocal().slice(0, 7), reason: '' };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const submit = async () => {
    const fd = new FormData();
    for (const [k, val] of Object.entries(v)) fd.set(k, val);
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try {
      await api.post('/payroll/loans/requests', fd);
      toast.success('Loan request sent to HR');
      onOpenChange(false);
      setV(blank);
      setFiles([]);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/payroll/loans') });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Request a loan" description="HR reviews your request. Once approved, instalments are deducted from your salary."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} disabled={!v.principal || !v.installment || v.reason.trim().length < 5} onClick={submit}><Send className="h-4 w-4" /> Send request</Button></>}>
      <div className="space-y-4">
        <FormGrid cols={3}>
          <Field label="Amount" required>{(a) => <Input {...a} type="number" min={1} value={v.principal} onChange={(e) => setV({ ...v, principal: e.target.value })} />}</Field>
          <Field label="Monthly instalment" required>{(a) => <Input {...a} type="number" min={1} value={v.installment} onChange={(e) => setV({ ...v, installment: e.target.value })} />}</Field>
          <Field label="First deduction" required>{(a) => <Input {...a} type="month" value={v.startPeriod} onChange={(e) => setV({ ...v, startPeriod: e.target.value })} />}</Field>
        </FormGrid>
        <Field label="Reason" required hint="At least 5 characters">{(a) => <Textarea {...a} rows={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />}</Field>
        <Field label="Supporting documents (optional)">{(a) => <FileUpload {...a} value={files} onChange={setFiles} multiple maxFiles={5} accept=".pdf,image/*" label="Upload documents" />}</Field>
      </div>
    </Dialog>
  );
}

/** D2 – loan records, repayments and outstanding balances. */
export default function LoansPage() {
  const { can, me } = useAuth();
  const currency = me?.tenant.currency ?? 'PKR';
  const manage = can(P.LOANS_MANAGE);
  const { data, isLoading } = useApi<Loan[]>('/payroll/loans');
  const { data: mine } = useApi<Loan[]>(manage && me?.employee ? '/payroll/loans?mine=true' : null);
  const [open, setOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const pending = manage ? (data ?? []).filter((l) => l.status === 'PENDING') : [];
  const [detail, setDetail] = useState<Loan | null>(null);
  const { data: reps } = useApi<Repayment[]>(detail ? `/payroll/loans/${detail.id}/repayments` : null);
  const [pay, setPay] = useState({ amount: 0, paidOn: todayLocal(), note: '' });
  const form = useZodForm(loanSchema, { startPeriod: todayLocal().slice(0, 7) } as never);
  const create = useAction('post', '/payroll/loans', { invalidate: ['/payroll/loans'], success: 'Loan recorded. Instalments are deducted in payroll automatically.', onSuccess: () => { setOpen(false); form.reset(); } });
  const repay = useAction('post', () => `/payroll/loans/${detail!.id}/repayments`, { invalidate: ['/payroll/loans'], success: 'Repayment recorded', body: () => pay, onSuccess: () => setPay({ amount: 0, paidOn: todayLocal(), note: '' }) });
  const num = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };
  return (
    <>
      <PageHeader title="Loans" description={manage ? 'Employee loans. Monthly instalments are deducted in payroll.' : 'Your loans and repayments.'} actions={<div className="flex gap-2">{me?.employee && <Button variant="outline" onClick={() => setRequestOpen(true)}><Send className="h-4 w-4" /> Request a loan</Button>}{manage && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record loan</Button>}</div>} />
      {!!pending.length && (
        <Card className="mb-6">
          <CardHeader title="Loan requests awaiting HR" />
          <DataTable rows={pending} rowKey={(l) => l.id} columns={[
            { key: 'e', header: 'Employee', cell: (l) => <span className="font-medium">{l.fullName}</span> },
            { key: 'p', header: 'Amount', cell: (l) => <span className="tabular-nums">{money(l.principal, currency)}</span> },
            { key: 'i', header: 'Instalment', hideOnMobile: true, cell: (l) => `${money(l.installment, currency)} from ${monthLabel(l.startPeriod)}` },
            { key: 'r', header: 'Reason', hideOnMobile: true, cell: (l) => <span className="text-muted-foreground">{l.reason}</span> },
            { key: 'f', header: 'Documents', cell: (l) => (l.fileIds.length ? <div className="flex gap-1">{l.fileIds.map((_, i) => <Button key={i} size="icon" variant="ghost" className="h-7 w-7" aria-label={`Download document ${i + 1}`} onClick={() => downloadFile(`/payroll/loans/${l.id}/files/${i}`, `loan-${i + 1}`).catch((e) => toast.error(e.message))}><Paperclip className="h-3.5 w-3.5" /></Button>)}</div> : '—') },
            { key: 'a', header: '', cell: (l) => <DecisionButtons path={`/payroll/loans/${l.id}/decision`} invalidate={['/payroll/loans']} /> },
          ]} />
        </Card>
      )}
      {!!mine?.length && (
        <Card className="mb-6">
          <CardHeader title="My loans" />
          <DataTable rows={mine} rowKey={(l) => l.id} onRowClick={setDetail} columns={[
            { key: 'p', header: 'Amount', cell: (l) => <span className="tabular-nums">{money(l.principal, currency)}</span> },
            { key: 'r', header: 'Outstanding', cell: (l) => money(l.outstanding, currency) },
            { key: 's', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
          ]} />
        </Card>
      )}
      <Card>
        <DataTable loading={isLoading} rows={data} rowKey={(l) => l.id} onRowClick={setDetail} empty="No loans" columns={[
          ...(manage ? [{ key: 'e', header: 'Employee', cell: (l: Loan) => <span className="font-medium">{l.fullName}</span> }] : []),
          { key: 'p', header: 'Amount', cell: (l) => <span className="tabular-nums">{money(l.principal, currency)}</span> },
          { key: 'i', header: 'Instalment', hideOnMobile: true, cell: (l) => <span className="tabular-nums">{money(l.installment, currency)} / month</span> },
          { key: 'r', header: 'Repaid', cell: (l) => <div className="w-36"><Progress value={(l.repaid / l.principal) * 100} /><p className="mt-1 text-xs text-muted-foreground">{money(l.outstanding, currency)} outstanding</p></div> },
          { key: 'f', header: 'From', hideOnMobile: true, cell: (l) => monthLabel(l.startPeriod) },
          { key: 's', header: 'Status', cell: (l) => <StatusBadge status={l.status} /> },
          ...(manage ? [{ key: 'del', header: <span className="sr-only">Delete</span>, cell: (l: Loan) => (l.repaid === 0 ? <DeleteButton iconOnly path={`/payroll/loans/${l.id}`} what={`${l.fullName}'s loan`} invalidate={['/payroll/loans']} detail="Only for loans recorded by mistake. Loans with repayments can't be deleted." /> : null) }] : []),
        ]} />
      </Card>
      <RequestLoanDialog open={requestOpen} onOpenChange={setRequestOpen} />
      <Dialog open={open} onOpenChange={setOpen} title="Record a loan" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(v))}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Employee" required error={fieldError(form, 'employeeId')}>{(a) => <EmployeeSelect {...a} value={(form.watch('employeeId') as string | null | undefined) ?? ''} onChange={(e) => form.setValue('employeeId', (e.target.value || undefined) as never, { shouldDirty: true, shouldValidate: true })} />}</Field>
          <FormGrid cols={3}>
            <Field label="Loan amount" required error={fieldError(form, 'principal')}>{(a) => <Input {...a} type="number" {...form.register('principal', num)} />}</Field>
            <Field label="Monthly instalment" required error={fieldError(form, 'installment')}>{(a) => <Input {...a} type="number" {...form.register('installment', num)} />}</Field>
            <Field label="First deduction" required error={fieldError(form, 'startPeriod')}>{(a) => <Input {...a} type="month" {...form.register('startPeriod')} />}</Field>
          </FormGrid>
          <Field label="Reason">{(a) => <Textarea {...a} rows={2} {...form.register('reason')} />}</Field>
        </div>
      </Dialog>
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)} title={detail ? `Loan · ${money(detail.principal, currency)}` : ''} description={detail ? `${money(detail.outstanding, currency)} outstanding` : ''} size="lg">
        <div className="space-y-5">
          <ul className="divide-y rounded-md border">
            {!reps?.length && <li className="p-3 text-sm text-muted-foreground">No repayments yet.</li>}
            {reps?.map((r) => <li key={r.id} className="flex justify-between p-3 text-sm"><span>{date(r.paidOn)} · {r.source === 'PAYROLL' ? 'Payroll deduction' : 'Manual'}{r.note ? ` · ${r.note}` : ''}</span><span className="tabular-nums">{money(r.amount, currency)}</span></li>)}
          </ul>
          {manage && detail?.status === 'ACTIVE' && (
            <div className="rounded-md border p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium"><HandCoins className="h-4 w-4" /> Record a manual repayment</p>
              <FormGrid cols={3}>
                <Field label="Amount">{(a) => <Input {...a} type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} />}</Field>
                <Field label="Paid on">{(a) => <Input {...a} type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} />}</Field>
                <Field label="Note">{(a) => <Input {...a} value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} />}</Field>
              </FormGrid>
              <Button className="mt-3" size="sm" disabled={pay.amount <= 0} loading={repay.isPending} onClick={() => repay.mutate(undefined)}>Save repayment</Button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
