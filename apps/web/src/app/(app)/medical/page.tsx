'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { HeartPulse, Paperclip, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DecisionButtons } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, EmptyState, PageHeader, Stat, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { FileUpload } from '@/components/ui/file-upload';
import { api, downloadFile } from '@/lib/api';
import { useAuth, useMedicalEligible } from '@/lib/auth';
import { date, money, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Claim { id: string; employeeId: string; fullName: string; amount: number; approvedAmount: number | null; claimDate: string; description: string; fileIds: string[]; status: string; currentStep: string | null; payrollRunId: string | null; canDecide: boolean }
interface Res { annualLimit: number; usedThisYear: number; remaining: number; items: Claim[] }

function ClaimsTable({ data, loading, showName, currency }: { data?: Claim[]; loading: boolean; showName?: boolean; currency: string }) {
  return (
    <DataTable loading={loading} rows={data} rowKey={(c) => c.id} empty="No claims" columns={[
      ...(showName ? [{ key: 'n', header: 'Employee', cell: (c: Claim) => <span className="font-medium">{c.fullName}</span> }] : []),
      { key: 'd', header: 'Date', cell: (c) => date(c.claimDate) },
      { key: 'x', header: 'Description', hideOnMobile: true, cell: (c) => <span className="line-clamp-2 text-muted-foreground">{c.description}</span> },
      { key: 'a', header: 'Amount', cell: (c) => <div className="tabular-nums">{money(c.amount, currency)}{c.approvedAmount !== null && c.approvedAmount !== c.amount && <p className="text-xs text-success">approved {money(c.approvedAmount, currency)}</p>}</div> },
      { key: 'f', header: 'Documents', cell: (c) => <div className="flex gap-1">{c.fileIds.map((_, i) => <Button key={i} size="icon" variant="ghost" className="h-7 w-7" aria-label={`Download document ${i + 1}`} onClick={() => downloadFile(`/payroll/medical/${c.id}/files/${i}`, `claim-${i + 1}`).catch((e) => toast.error(e.message))}><Paperclip className="h-3.5 w-3.5" /></Button>)}</div> },
      { key: 's', header: 'Status', cell: (c) => <div className="flex flex-col gap-0.5"><StatusBadge status={c.status} step={c.currentStep} />{c.payrollRunId && <span className="text-xs text-muted-foreground">paid in payroll</span>}</div> },
      { key: 'z', header: '', cell: (c) => (c.canDecide ? <DecisionButtons path={`/payroll/medical/${c.id}/decision`} invalidate={['/payroll/medical']} extra={(approve) => (approve ? <Field label="Approved amount" hint={`Claimed ${money(c.amount, currency)}`}>{(a) => <Input {...a} type="number" data-field="approvedAmount" defaultValue={c.amount} />}</Field> : null)} /> : null) },
    ]} />
  );
}

/** D3 – medical allowance claims with supporting documents. */
export default function MedicalPage() {
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const currency = me?.tenant.currency ?? 'PKR';
  // Offered to this person? (HR ticks "Eligible for medical claims" per employee; the company sets the yearly limit.)
  const eligible = useMedicalEligible();
  const { data: mine, isLoading } = useApi<Res>(eligible ? '/payroll/medical?mine=true' : null);
  const { data: all, isLoading: allLoading } = useApi<Res>(can(P.MEDICAL_MANAGE) ? '/payroll/medical' : null);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ amount: '', claimDate: todayLocal(), description: '' });
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const submit = async () => {
    if (!files.length) return toast.error('Attach at least one receipt or prescription');
    const fd = new FormData();
    fd.set('amount', v.amount);
    fd.set('claimDate', v.claimDate);
    fd.set('description', v.description);
    for (const f of files) fd.append('files', f);
    setBusy(true);
    try {
      await api.post('/payroll/medical', fd);
      toast.success('Claim submitted to HR');
      setOpen(false);
      setV({ amount: '', claimDate: todayLocal(), description: '' });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/payroll/medical') });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Medical claims" description="Claim medical expenses with proper documents. Approved claims are reimbursed in payroll." actions={eligible && <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New claim</Button>} />
      {!eligible && !can(P.MEDICAL_MANAGE) && (
        <Card><EmptyState icon={HeartPulse} title="Medical claims aren't part of your benefits" description="Your company hasn't enabled medical claims for you. Ask HR if you think this is wrong." /></Card>
      )}
      <Tabs tabs={[
        {
          value: 'mine', label: 'My claims', hidden: !eligible,
          content: (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Annual limit" icon={HeartPulse} value={money(mine?.annualLimit, currency)} />
                <Stat label="Used this year" tone="warning" value={money(mine?.usedThisYear, currency)} />
                <Stat label="Remaining" tone="success" value={money(mine?.remaining, currency)} />
              </div>
              <Card><ClaimsTable data={mine?.items} loading={isLoading} currency={currency} /></Card>
            </div>
          ),
        },
        { value: 'all', label: 'All claims', hidden: !can(P.MEDICAL_MANAGE), content: <Card><CardHeader title="Claims to review" /><ClaimsTable data={all?.items} loading={allLoading} showName currency={currency} /></Card> },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="New medical claim" description="Attach receipts, prescriptions or reports (PDF or image, up to 5 files)."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!v.amount || v.description.length < 5} onClick={submit}>Submit claim</Button></>}>
        <div className="space-y-4">
          <FormGrid>
            <Field label="Amount" required>{(a) => <Input {...a} type="number" min={1} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />}</Field>
            <Field label="Date of expense" required>{(a) => <Input {...a} type="date" max={todayLocal()} value={v.claimDate} onChange={(e) => setV({ ...v, claimDate: e.target.value })} />}</Field>
          </FormGrid>
          <Field label="Description" required>{(a) => <Textarea {...a} rows={3} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
          <Field label="Supporting documents" required>{(a) => <FileUpload {...a} value={files} onChange={setFiles} multiple maxFiles={5} accept=".pdf,image/*" required label="Upload receipts" />}</Field>
        </div>
      </Dialog>
    </>
  );
}
