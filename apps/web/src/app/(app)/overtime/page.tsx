'use client';

import { PERMISSIONS as P, compensationRequestSchema } from '@hrms/shared';
import { HandCoins } from 'lucide-react';
import { useState } from 'react';
import { DecisionButtons } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, PageHeader, Stat, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { date, hours, todayLocal } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';

interface OT { id: string; employeeId: string; employeeName: string; date: string; minutes: number; approvedMinutes: number | null; workDescription: string | null; status: string; currentStep: string | null; canDecide: boolean }
interface Comp { id: string; employeeName: string; type: 'PAID' | 'HALF_DAY' | 'REDUCED_HOURS'; minutes: number; date: string | null; reason: string; status: string; currentStep: string | null; createdAt: string; canDecide: boolean }
const compLabel = (c: Comp) => (c.type === 'PAID' ? 'Paid' : c.type === 'HALF_DAY' ? `Half day · ${date(c.date)}` : `Shorter day · ${date(c.date)}`);

interface Balance { earnedMinutes: number; usedMinutes: number; availableMinutes: number; dayMinutes: number }

function RequestDialog({ open, onOpenChange, balance }: { open: boolean; onOpenChange: (o: boolean) => void; balance?: Balance }) {
  const form = useZodForm(compensationRequestSchema, { type: 'HALF_DAY', minutes: 240, reason: '' });
  const type = form.watch('type');
  const submit = useAction('post', '/attendance/compensation', { invalidate: ['/attendance'], success: 'Request sent to your Team Lead', onSuccess: () => { onOpenChange(false); form.reset(); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Use my overtime" description={`Available: ${hours(balance?.availableMinutes ?? 0)}. Approved by your Team Lead, then HR.`}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={submit.isPending} onClick={form.handleSubmit((v) => submit.mutate(v))}>Submit</Button></>}>
      <div className="space-y-4">
        <Field label="How would you like to use it?" error={fieldError(form, 'type')}>
          {(a) => <Select {...a} {...form.register('type')}><option value="HALF_DAY">Half day off (emergency)</option><option value="REDUCED_HOURS">Work fewer hours on a day (if your Team Lead / HR allows)</option><option value="PAID">Paid compensation (if your department allows)</option></Select>}
        </Field>
        {type === 'HALF_DAY' ? (
          <Field label="Half-day date" required error={fieldError(form, 'date')} hint={`Uses ${hours(Math.round((balance?.dayMinutes ?? 480) / 2))} of overtime`}>{(a) => <Input {...a} type="date" {...form.register('date')} />}</Field>
        ) : type === 'REDUCED_HOURS' ? (
          <FormGrid>
            <Field label="Working day to shorten" required error={fieldError(form, 'date')} hint="Usually the next working day">{(a) => <Input {...a} type="date" min={todayLocal()} {...form.register('date')} />}</Field>
            <Field label="Fewer minutes required" required error={fieldError(form, 'minutes')} hint="e.g. 120 = 2 hours">{(a) => <Input {...a} type="number" min={30} step={30} {...form.register('minutes', { valueAsNumber: true })} />}</Field>
          </FormGrid>
        ) : (
          <Field label="Minutes to be paid" required error={fieldError(form, 'minutes')}>{(a) => <Input {...a} type="number" min={30} step={30} {...form.register('minutes', { valueAsNumber: true })} />}</Field>
        )}
        <Field label="Reason" required error={fieldError(form, 'reason')}>{(a) => <Textarea {...a} rows={3} {...form.register('reason')} />}</Field>
      </div>
    </Dialog>
  );
}

function Mine() {
  const { data: bal } = useApi<Balance>('/attendance/compensation/balance');
  const { data: ot, isLoading } = useApi<OT[]>('/attendance/overtime?mine=true');
  const { data: comp } = useApi<Comp[]>('/attendance/compensation?mine=true');
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Approved overtime" value={hours(bal?.earnedMinutes)} />
        <Stat label="Used / requested" tone="warning" value={hours(bal?.usedMinutes)} />
        <Stat label="Available" tone="success" icon={HandCoins} value={hours(bal?.availableMinutes)} hint={<Button size="sm" variant="link" className="h-auto" onClick={() => setOpen(true)}>Request compensation</Button>} />
      </div>
      <Card>
        <CardHeader title="My overtime" description="Calculated from attendance and approved by your Team Lead." />
        <DataTable loading={isLoading} rows={ot} rowKey={(o) => o.id} empty="No overtime recorded" columns={[
          { key: 'd', header: 'Date', cell: (o) => date(o.date) },
          { key: 'm', header: 'Overtime', cell: (o) => hours(o.approvedMinutes ?? o.minutes) },
          { key: 'w', header: 'Work performed', hideOnMobile: true, cell: (o) => <span className="text-muted-foreground">{o.workDescription ?? '—'}</span> },
          { key: 's', header: 'Status', cell: (o) => <StatusBadge status={o.status} step={o.currentStep} /> },
        ]} />
      </Card>
      <Card>
        <CardHeader title="My compensation requests" />
        <DataTable rows={comp} rowKey={(c) => c.id} empty="No requests yet" columns={[
          { key: 't', header: 'Type', cell: (c) => compLabel(c) },
          { key: 'm', header: 'Overtime used', cell: (c) => hours(c.minutes) },
          { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} step={c.currentStep} /> },
        ]} />
      </Card>
      <RequestDialog open={open} onOpenChange={setOpen} balance={bal} />
    </div>
  );
}

function TeamApprovals() {
  const { data: ot, isLoading } = useApi<OT[]>('/attendance/overtime');
  const { data: comp } = useApi<Comp[]>('/attendance/compensation');
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Overtime" description="State the work performed when approving." />
        <DataTable loading={isLoading} rows={ot} rowKey={(o) => o.id} empty="No overtime to review" columns={[
          { key: 'e', header: 'Employee', cell: (o) => <span className="font-medium">{o.employeeName}</span> },
          { key: 'd', header: 'Date', cell: (o) => date(o.date) },
          { key: 'm', header: 'Overtime', cell: (o) => hours(o.approvedMinutes ?? o.minutes) },
          { key: 'w', header: 'Work', hideOnMobile: true, cell: (o) => <span className="text-muted-foreground">{o.workDescription ?? '—'}</span> },
          { key: 's', header: 'Status', cell: (o) => <StatusBadge status={o.status} step={o.currentStep} /> },
          { key: 'a', header: '', cell: (o) => (o.canDecide ? <DecisionButtons path={`/attendance/overtime/${o.id}/decision`} invalidate={['/attendance']} requireCommentOnApprove="Work performed during overtime" /> : null) },
        ]} />
      </Card>
      <Card>
        <CardHeader title="Compensation requests" />
        <DataTable rows={comp} rowKey={(c) => c.id} empty="No requests" columns={[
          { key: 'e', header: 'Employee', cell: (c) => <span className="font-medium">{c.employeeName}</span> },
          { key: 't', header: 'Type', cell: (c) => compLabel(c) },
          { key: 'm', header: 'Minutes', cell: (c) => hours(c.minutes) },
          { key: 'r', header: 'Reason', hideOnMobile: true, cell: (c) => <span className="text-muted-foreground">{c.reason}</span> },
          { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} step={c.currentStep} /> },
          { key: 'a', header: '', cell: (c) => (c.canDecide ? <DecisionButtons path={`/attendance/compensation/${c.id}/decision`} invalidate={['/attendance']} /> : null) },
        ]} />
      </Card>
    </div>
  );
}

/** C2 – overtime & compensation. */
export default function OvertimePage() {
  const { can, me } = useAuth();
  return (
    <>
      <PageHeader title="Overtime & compensation" description="Overtime is approved by your Team Lead. Use it as paid compensation, a half day off, compensation leave, or fewer hours on a working day." />
      <Tabs tabs={[
        { value: 'me', label: 'Mine', hidden: !me?.employee, content: <Mine /> },
        { value: 'team', label: 'Approvals', hidden: !can(P.OVERTIME_APPROVE_TL, P.COMPENSATION_APPROVE_TL, P.COMPENSATION_APPROVE_HR, P.ATTENDANCE_READ_ALL), content: <TeamApprovals /> },
      ]} />
    </>
  );
}
