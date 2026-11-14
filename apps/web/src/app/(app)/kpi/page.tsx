'use client';

import { PERMISSIONS as P, kpiSubmissionSchema, kpiTargetSchema } from '@hrms/shared';
import { Plus, Target, Trophy } from 'lucide-react';
import { useState } from 'react';
import { DecisionButtons, EmployeeSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, Progress, Stat, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { money, monthLabel, todayLocal } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';
import { AttachmentLinks } from '@/components/file-preview';
import { FileUpload } from '@/components/ui/file-upload';

interface TargetRow { id: string; employeeId: string; fullName: string; period: string; metric: string; unit: string; targetValue: number; incentiveType: string; incentiveValue: number; achieved: number | null; progress: number | null }
interface Sub { id: string; employeeId: string; fullName: string; period: string; metric: string; achievedValue: number; targetValue: number | null; unit: string | null; notes: string | null; tlRemarks: string | null; hrRemarks: string | null; status: string; currentStep: string | null; canDecide: boolean; fileIds?: string[] }
interface Incentive { id: string; fullName: string; period: string; amount: number; status: string }

const fmt = (n: number, unit?: string | null) => (unit && unit.length === 3 && unit === unit.toUpperCase() ? money(n, unit) : `${n.toLocaleString()} ${unit ?? ''}`);

function SubmitDialog({ open, onOpenChange, targets }: { open: boolean; onOpenChange: (o: boolean) => void; targets: TargetRow[] }) {
  const form = useZodForm(kpiSubmissionSchema, { period: todayLocal().slice(0, 7), metric: '' } as never);
  const [files, setFiles] = useState<File[]>([]);
  // Sent as a form so proof of the work done can go with the results.
  const submit = useAction<Record<string, unknown>>('post', '/kpi/submissions', {
    invalidate: ['/kpi'],
    success: 'Results submitted to your Team Lead',
    onSuccess: () => { onOpenChange(false); form.reset(); setFiles([]); },
    body: (v) => {
      const fd = new FormData();
      for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null && x !== '') fd.set(k, String(x));
      for (const f of files) fd.append('files', f);
      return fd;
    },
  });
  const pick = (id: string) => {
    const t = targets.find((x) => x.id === id);
    form.setValue('targetId', (id || undefined) as never);
    if (t) { form.setValue('metric', t.metric as never); form.setValue('period', t.period as never); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Submit results" description="Reviewed by your Team Lead, then approved by HR."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={submit.isPending} onClick={form.handleSubmit((v) => submit.mutate(v))}>Submit</Button></>}>
      <div className="space-y-4">
        <Field label="Target">{(a) => <Select {...a} onChange={(e) => pick(e.target.value)}><option value="">No target (general result)</option>{targets.filter((t) => t.achieved === null).map((t) => <option key={t.id} value={t.id}>{t.metric} · {monthLabel(t.period)}</option>)}</Select>}</Field>
        <FormGrid>
          <Field label="Metric" required error={fieldError(form, 'metric')}>{(a) => <Input {...a} {...form.register('metric')} />}</Field>
          <Field label="Period" required error={fieldError(form, 'period')}>{(a) => <Input {...a} type="month" {...form.register('period')} />}</Field>
        </FormGrid>
        <Field label="Achieved" required error={fieldError(form, 'achievedValue')}>{(a) => <Input {...a} type="number" {...form.register('achievedValue', { valueAsNumber: true })} />}</Field>
        <Field label="Notes" hint="What you did to reach this result">{(a) => <Textarea {...a} rows={3} {...form.register('notes')} />}</Field>
        <Field label="Proof of work (optional)" hint="Reports, screenshots or documents that show the work done. Up to 5 files.">
          {(a) => <FileUpload {...a} value={files} onChange={setFiles} multiple maxFiles={5} accept=".pdf,image/*" label="Attach files" />}
        </Field>
      </div>
    </Dialog>
  );
}

function TargetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { isTeamLead, can } = useAuth();
  const form = useZodForm(kpiTargetSchema, { period: todayLocal().slice(0, 7), metric: 'Sales revenue', unit: 'PKR', incentiveType: 'PERCENT_OF_EXCESS', incentiveValue: 5 } as never);
  const save = useAction('post', '/kpi/targets', { invalidate: ['/kpi'], success: 'Target set', onSuccess: () => { onOpenChange(false); form.reset(); } });
  const type = form.watch('incentiveType');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Set a target" description="Exceeding the target makes the employee eligible for an incentive." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}>Save target</Button></>}>
      <div className="space-y-4">
        <Field label="Employee" required error={fieldError(form, 'employeeId')} hint={!can(P.KPI_TARGETS_MANAGE) && isTeamLead ? 'Your team members only' : undefined}>{(a) => <EmployeeSelect {...a} value={(form.watch('employeeId') as string | undefined) ?? ''} onChange={(e) => form.setValue('employeeId', (e.target.value || undefined) as never, { shouldDirty: true, shouldValidate: true })} />}</Field>
        <FormGrid cols={3}>
          <Field label="Metric" required error={fieldError(form, 'metric')}>{(a) => <Input {...a} {...form.register('metric')} />}</Field>
          <Field label="Unit" error={fieldError(form, 'unit')}>{(a) => <Input {...a} {...form.register('unit')} />}</Field>
          <Field label="Period" required error={fieldError(form, 'period')}>{(a) => <Input {...a} type="month" {...form.register('period')} />}</Field>
        </FormGrid>
        <FormGrid cols={3}>
          <Field label="Target" required error={fieldError(form, 'targetValue')}>{(a) => <Input {...a} type="number" {...form.register('targetValue', { valueAsNumber: true })} />}</Field>
          <Field label="Incentive">{(a) => <Select {...a} {...form.register('incentiveType')}><option value="PERCENT_OF_EXCESS">% of amount above target</option><option value="FIXED">Fixed bonus</option></Select>}</Field>
          <Field label={type === 'FIXED' ? 'Bonus amount' : 'Percentage'}>{(a) => <Input {...a} type="number" step="0.1" {...form.register('incentiveValue', { valueAsNumber: true })} />}</Field>
        </FormGrid>
      </div>
    </Dialog>
  );
}

function SubsTable({ rows, loading, showName }: { rows?: Sub[]; loading: boolean; showName?: boolean }) {
  return (
    <DataTable loading={loading} rows={rows} rowKey={(s) => s.id} empty="No submissions" columns={[
      ...(showName ? [{ key: 'n', header: 'Employee', cell: (s: Sub) => <span className="font-medium">{s.fullName}</span> }] : []),
      { key: 'm', header: 'Metric', cell: (s) => <div><p>{s.metric}</p><p className="text-xs text-muted-foreground">{monthLabel(s.period)}</p></div> },
      { key: 'a', header: 'Achieved', cell: (s) => <div className="tabular-nums">{fmt(s.achievedValue, s.unit)}{s.targetValue !== null && <p className="text-xs text-muted-foreground">target {fmt(s.targetValue, s.unit)}</p>}</div> },
      { key: 'p', header: 'Proof', cell: (s) => (s.fileIds?.length ? <AttachmentLinks base={`/kpi/submissions/${s.id}/files`} count={s.fileIds.length} /> : <span className="text-xs text-muted-foreground">—</span>) },
      { key: 'r', header: 'Remarks', hideOnMobile: true, cell: (s) => <div className="max-w-xs text-xs text-muted-foreground">{s.notes && <p className="text-foreground">{s.notes}</p>}{s.tlRemarks && <p>TL: {s.tlRemarks}</p>}{s.hrRemarks && <p>HR: {s.hrRemarks}</p>}</div> },
      { key: 's', header: 'Status', cell: (s) => <StatusBadge status={s.status} step={s.currentStep} /> },
      { key: 'x', header: '', cell: (s) => (s.canDecide ? <DecisionButtons path={`/kpi/submissions/${s.id}/decision`} invalidate={['/kpi']} commentLabel="Remarks & feedback" /> : null) },
    ]} />
  );
}

/** E1–E2 – KPI management and incentives. */
export default function KpiPage() {
  const { can, me, isTeamLead } = useAuth();
  const currency = me?.tenant.currency ?? 'PKR';
  const { data: myTargets } = useApi<TargetRow[]>(me?.employee ? '/kpi/targets?mine=true' : null);
  const { data: mySubs, isLoading: msl } = useApi<Sub[]>(me?.employee ? '/kpi/submissions?mine=true' : null);
  const { data: myInc } = useApi<Incentive[]>(me?.employee ? '/kpi/incentives?mine=true' : null);
  const reviewer = can(P.KPI_APPROVE_TL, P.KPI_APPROVE_HR);
  const { data: allSubs, isLoading: asl } = useApi<Sub[]>(reviewer ? '/kpi/submissions' : null);
  const { data: allTargets } = useApi<TargetRow[]>(reviewer ? '/kpi/targets' : null);
  const { data: allInc } = useApi<Incentive[]>(can(P.INCENTIVES_MANAGE) ? '/kpi/incentives' : null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const earned = (myInc ?? []).filter((i) => i.status !== 'VOID').reduce((a, i) => a + i.amount, 0);

  return (
    <>
      <PageHeader title="KPI & performance" description="Submit results, track targets and incentives." actions={<>
        {(can(P.KPI_TARGETS_MANAGE) || isTeamLead) && <Button variant="outline" onClick={() => setTargetOpen(true)}><Target className="h-4 w-4" /> Set target</Button>}
        {me?.employee && <Button onClick={() => setSubmitOpen(true)}><Plus className="h-4 w-4" /> Submit results</Button>}
      </>} />
      <Tabs tabs={[
        {
          value: 'mine', label: 'My performance', hidden: !me?.employee,
          content: (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Active targets" icon={Target} value={myTargets?.filter((t) => t.period === todayLocal().slice(0, 7)).length ?? 0} />
                <Stat label="Submissions" value={mySubs?.length ?? 0} hint={`${mySubs?.filter((s) => s.status === 'PENDING').length ?? 0} pending review`} />
                <Stat label="Incentives earned" icon={Trophy} tone="success" value={money(earned, currency)} />
              </div>
              <Card>
                <CardHeader title="My targets" />
                <DataTable rows={myTargets} rowKey={(t) => t.id} empty="No targets assigned" columns={[
                  { key: 'm', header: 'Metric', cell: (t) => <div><p className="font-medium">{t.metric}</p><p className="text-xs text-muted-foreground">{monthLabel(t.period)}</p></div> },
                  { key: 't', header: 'Target', cell: (t) => <span className="tabular-nums">{fmt(t.targetValue, t.unit)}</span> },
                  { key: 'p', header: 'Progress', cell: (t) => <div className="w-40"><Progress value={t.progress ?? 0} /><p className="mt-1 text-xs text-muted-foreground">{t.achieved !== null ? `${fmt(t.achieved, t.unit)} · ${t.progress}%` : 'Not submitted'}</p></div> },
                  { key: 'i', header: 'Incentive', hideOnMobile: true, cell: (t) => <span className="text-xs text-muted-foreground">{t.incentiveType === 'FIXED' ? `${money(t.incentiveValue, currency)} if exceeded` : `${t.incentiveValue}% of excess`}</span> },
                ]} />
              </Card>
              <Card><CardHeader title="My submissions & history" /><SubsTable rows={mySubs} loading={msl} /></Card>
              {!!myInc?.length && (
                <Card>
                  <CardHeader title="My incentives" />
                  <DataTable rows={myInc} rowKey={(i) => i.id} columns={[
                    { key: 'p', header: 'Period', cell: (i) => monthLabel(i.period) },
                    { key: 'a', header: 'Amount', cell: (i) => <span className="tabular-nums">{money(i.amount, currency)}</span> },
                    { key: 's', header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                  ]} />
                </Card>
              )}
            </div>
          ),
        },
        {
          value: 'review', label: 'Team & approvals', hidden: !reviewer,
          content: (
            <div className="space-y-6">
              <Card><CardHeader title="Submissions" /><SubsTable rows={allSubs} loading={asl} showName /></Card>
              <Card>
                <CardHeader title="Targets" />
                <DataTable rows={allTargets} rowKey={(t) => t.id} empty="No targets" columns={[
                  { key: 'n', header: 'Employee', cell: (t) => <span className="font-medium">{t.fullName}</span> },
                  { key: 'm', header: 'Metric', cell: (t) => `${t.metric} · ${monthLabel(t.period)}` },
                  { key: 'p', header: 'Progress', cell: (t) => <div className="w-40"><Progress value={t.progress ?? 0} /><p className="mt-1 text-xs text-muted-foreground">{t.achieved !== null ? `${t.progress}%` : 'Not submitted'}</p></div> },
                  { key: 'x', header: <span className="sr-only">Delete</span>, cell: (t) => (t.achieved === null ? <DeleteButton iconOnly path={`/kpi/targets/${t.id}`} what={`the "${t.metric}" target`} invalidate={['/kpi']} /> : null) },
                ]} />
              </Card>
              {!!allInc?.length && (
                <Card>
                  <CardHeader title="Incentives" description="Paid automatically in the next payroll run." />
                  <DataTable rows={allInc} rowKey={(i) => i.id} columns={[
                    { key: 'n', header: 'Employee', cell: (i) => i.fullName },
                    { key: 'p', header: 'Period', cell: (i) => monthLabel(i.period) },
                    { key: 'a', header: 'Amount', cell: (i) => money(i.amount, currency) },
                    { key: 's', header: 'Status', cell: (i) => <Badge tone={i.status === 'PAID' ? 'success' : i.status === 'VOID' ? 'neutral' : 'primary'}>{i.status.toLowerCase()}</Badge> },
                  ]} />
                </Card>
              )}
            </div>
          ),
        },
      ]} />
      <SubmitDialog open={submitOpen} onOpenChange={setSubmitOpen} targets={myTargets ?? []} />
      <TargetDialog open={targetOpen} onOpenChange={setTargetOpen} />
    </>
  );
}
