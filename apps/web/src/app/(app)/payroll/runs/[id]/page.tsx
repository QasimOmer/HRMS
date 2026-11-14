'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { ArrowLeft, Banknote, Lock, RefreshCw, Send, Unlock } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { DecisionButtons } from '@/components/domain';
import { PayslipView, type Payslip } from '@/components/payslip-view';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, ErrorState, PageHeader, Skeleton, Stat, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { dateTime, hours, money, monthLabel } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface RunDetail {
  id: string; period: string; status: string; currentStep: string | null; totalGross: number; totalNet: number; employeeCount: number; canDecide: boolean; reopenedAt: string | null; reopenReason: string | null;
  history: { id: string; step: string | null; action: string; comment: string | null; createdAt: string; actorEmail: string | null }[];
  payslips: (Payslip & { employeeId: string; fullName: string; employeeCode: string; departmentName: string })[];
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const currency = me?.tenant.currency ?? 'PKR';
  const key = `/payroll/runs/${id}`;
  const { data: run, isLoading, error } = useApi<RunDetail>(key);
  const [slipId, setSlipId] = useState<string | null>(null);
  const [adj, setAdj] = useState({ kind: 'ALLOWANCE', label: '', amount: 0 });
  const { confirm, node } = useConfirm();
  const inv = ['/payroll'];
  const recalc = useAction('post', `${key}/recalculate`, { invalidate: inv, success: 'Recalculated with the latest attendance and data' });
  const submit = useAction('post', `${key}/submit`, { invalidate: inv, success: 'Submitted for HR approval' });
  const paid = useAction('post', `${key}/mark-paid`, { invalidate: inv, success: 'Marked as paid' });
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reopen = useAction('post', `${key}/reopen`, { invalidate: inv, success: 'Payroll reopened as a draft', body: () => ({ reason }), onSuccess: () => { setReopenOpen(false); setReason(''); } });
  const addAdj = useAction('post', () => `/payroll/payslips/${slipId}/adjustments`, { invalidate: inv, success: 'Adjustment added', body: () => adj, onSuccess: () => setAdj({ kind: 'ALLOWANCE', label: '', amount: 0 }) });
  const rmAdj = useAction<number>('del', (i) => `/payroll/payslips/${slipId}/adjustments/${i}`, { invalidate: inv, success: 'Adjustment removed' });

  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !run) return <Skeleton className="h-96" />;
  const editable = ['DRAFT', 'REJECTED'].includes(run.status) && can(P.PAYROLL_PROCESS);
  const slip = run.payslips.find((p) => p.id === slipId);

  return (
    <>
      <Link href="/payroll" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Payroll</Link>
      <PageHeader
        title={`Payroll · ${monthLabel(run.period)}`}
        description={run.status === 'PENDING_APPROVAL' ? `Waiting for ${run.currentStep === 'HR' ? 'HR' : 'Operations'} approval` : undefined}
        actions={<>
          <StatusBadge status={run.status} />
          {editable && <Button variant="outline" loading={recalc.isPending} onClick={() => recalc.mutate(undefined)}><RefreshCw className="h-4 w-4" /> Recalculate</Button>}
          {editable && <Button loading={submit.isPending} onClick={async () => { if (await confirm({ title: 'Submit payroll for approval?', body: 'It will be recalculated one final time, then go to HR and Operations for approval. Adjustments are locked while it is under review.' })) submit.mutate(undefined); }}><Send className="h-4 w-4" /> Submit for approval</Button>}
          {run.canDecide && <DecisionButtons size="md" path={`${key}/decision`} invalidate={inv} />}
          {run.status === 'APPROVED' && can(P.PAYROLL_PROCESS) && <Button variant="success" loading={paid.isPending} onClick={() => paid.mutate(undefined)}><Banknote className="h-4 w-4" /> Mark as paid</Button>}
          {run.status === 'APPROVED' && can(P.PAYROLL_PROCESS) && <Button variant="outline" onClick={() => setReopenOpen(true)}><Unlock className="h-4 w-4" /> Reopen</Button>}
        </>}
      />
      {['APPROVED', 'PAID'].includes(run.status) && <p className="mb-4 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"><Lock className="h-4 w-4" /> This month is locked. Changes require HR to reopen it (recorded in the audit log).</p>}
      {run.reopenedAt && <p className="mb-4 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-sm">Reopened {dateTime(run.reopenedAt)}: {run.reopenReason}</p>}
      <Dialog open={reopenOpen} onOpenChange={setReopenOpen} title="Reopen approved payroll?" description="Loan instalments booked by this run are reversed and the run returns to draft. It must be approved by HR and Operations again."
        footer={<><Button variant="outline" onClick={() => setReopenOpen(false)}>Cancel</Button><Button variant="danger" disabled={reason.trim().length < 5} loading={reopen.isPending} onClick={() => reopen.mutate(undefined)}>Reopen</Button></>}>
        <Field label="Reason" required hint="Saved in the audit log">{(a) => <Textarea {...a} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </Dialog>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Employees" value={run.employeeCount} />
        <Stat label="Total gross" value={money(run.totalGross, currency)} />
        <Stat label="Total net pay" tone="success" value={money(run.totalNet, currency)} />
      </div>
      <Card className="mb-6">
        <CardHeader title="Salary slips" description="Click a row to view or adjust." />
        <DataTable rows={run.payslips} rowKey={(p) => p.id} onRowClick={(p) => setSlipId(p.id)} columns={[
          { key: 'n', header: 'Employee', cell: (p) => <div><p className="font-medium">{p.fullName}</p><p className="text-xs text-muted-foreground">{p.employeeCode} · {p.departmentName}</p></div> },
          { key: 'h', header: 'Paid hours', hideOnMobile: true, cell: (p) => <span className="tabular-nums">{hours(Math.min(p.payableMinutes, p.scheduledMinutes))} / {hours(p.scheduledMinutes)}</span> },
          { key: 'b', header: 'Basic earned', hideOnMobile: true, cell: (p) => <span className="tabular-nums">{money(p.earnedBasic, currency)}</span> },
          { key: 'a', header: 'Allowances', hideOnMobile: true, cell: (p) => <span className="tabular-nums text-success">+{money(p.totalAllowances, currency)}</span> },
          { key: 'd', header: 'Deductions', hideOnMobile: true, cell: (p) => <span className="tabular-nums text-danger">−{money(p.totalDeductions, currency)}</span> },
          { key: 'net', header: 'Net', cell: (p) => <span className="font-semibold tabular-nums">{money(p.net, currency)}</span> },
          { key: 'm', header: '', cell: (p) => (p.lines.some((l) => l.manual) ? <Badge tone="info">adjusted</Badge> : null) },
        ]} />
      </Card>
      {!!run.history.length && (
        <Card>
          <CardHeader title="Approval history" />
          <ul className="divide-y">
            {run.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                <span><span className="font-medium">{h.actorEmail ?? 'system'}</span> <span className="text-muted-foreground">{h.action.toLowerCase()}{h.step ? ` at ${h.step === 'HR' ? 'HR' : h.step === 'OPERATIONS' ? 'Operations' : h.step} step` : ''}</span>{h.comment ? ` – “${h.comment}”` : ''}</span>
                <span className="text-xs text-muted-foreground">{dateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Dialog open={!!slip} onOpenChange={(o) => !o && setSlipId(null)} title="Salary slip" size="lg">
        {slip && (
          <div className="space-y-6">
            <PayslipView slip={slip} currency={currency} onRemoveLine={editable ? (i) => rmAdj.mutate(i) : undefined} />
            {editable && (
              <CardBody className="rounded-md border p-4">
                <p className="mb-3 text-sm font-medium">Add adjustment</p>
                <FormGrid cols={3}>
                  <Field label="Type">{(a) => <Select {...a} value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })}><option value="ALLOWANCE">Allowance</option><option value="BONUS">Bonus</option><option value="DEDUCTION">Deduction</option></Select>}</Field>
                  <Field label="Label">{(a) => <Input {...a} value={adj.label} onChange={(e) => setAdj({ ...adj, label: e.target.value })} />}</Field>
                  <Field label="Amount">{(a) => <Input {...a} type="number" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: Number(e.target.value) })} />}</Field>
                </FormGrid>
                <Button className="mt-3" size="sm" disabled={adj.label.length < 2 || adj.amount <= 0} loading={addAdj.isPending} onClick={() => addAdj.mutate(undefined)}>Add adjustment</Button>
              </CardBody>
            )}
          </div>
        )}
      </Dialog>
      {node}
    </>
  );
}
