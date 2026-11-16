'use client';

import { PERMISSIONS as P, salaryComponentSchema } from '@hrms/shared';
import { Plus, PlayCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DepartmentSelect, EmployeeSelect } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { dateTime, money, monthLabel, todayLocal } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';

interface Run { id: string; period: string; status: string; currentStep: string | null; totalGross: number; totalNet: number; employeeCount: number; processedAt: string | null; canDecide: boolean }
interface Comp { id: string; kind: string; code: string; label: string; amount: number; isPercentOfBasic: boolean; employeeName: string | null; departmentName: string | null; isActive: boolean }

function Runs() {
  const router = useRouter();
  const { can, me } = useAuth();
  const { data, isLoading } = useApi<Run[]>('/payroll/runs');
  const [period, setPeriod] = useState(todayLocal().slice(0, 7));
  const [open, setOpen] = useState(false);
  const create = useAction<{ period: string }, Run>('post', '/payroll/runs', { invalidate: ['/payroll'], success: 'Payroll calculated', onSuccess: (r) => router.push(`/payroll/runs/${r.id}`) });
  return (
    <Card>
      <CardHeader title="Payroll runs" description="Processed and approved by HR and Operations." action={can(P.PAYROLL_PROCESS) && <Button size="sm" onClick={() => setOpen(true)}><PlayCircle className="h-4 w-4" /> Process payroll</Button>} />
      <DataTable loading={isLoading} rows={data} rowKey={(r) => r.id} onRowClick={(r) => router.push(`/payroll/runs/${r.id}`)} empty="No payroll processed yet" columns={[
        { key: 'p', header: 'Period', cell: (r) => <span className="font-medium">{monthLabel(r.period)}</span> },
        { key: 'e', header: 'Employees', cell: (r) => r.employeeCount },
        { key: 'g', header: 'Gross', hideOnMobile: true, cell: (r) => <span className="tabular-nums">{money(r.totalGross, me?.tenant.currency)}</span> },
        { key: 'n', header: 'Net pay', cell: (r) => <span className="font-medium tabular-nums">{money(r.totalNet, me?.tenant.currency)}</span> },
        { key: 's', header: 'Status', cell: (r) => <div className="flex items-center gap-2"><StatusBadge status={r.status} />{r.status === 'PENDING_APPROVAL' && <Badge tone="warning">{r.currentStep === 'HR' ? 'HR' : 'Operations'}</Badge>}{r.canDecide && <Badge tone="primary">your turn</Badge>}</div> },
        { key: 'del', header: <span className="sr-only">Delete</span>, cell: (r) => (['DRAFT', 'REJECTED'].includes(r.status) ? <DeleteButton iconOnly path={`/payroll/runs/${r.id}`} what={`the draft payroll for ${monthLabel(r.period)}`} invalidate={['/payroll']} /> : null) },
        { key: 'd', header: 'Processed', hideOnMobile: true, cell: (r) => <span className="text-muted-foreground">{dateTime(r.processedAt)}</span> },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="Process payroll" description="Calculates every employee's salary from working hours, allowances, deductions, loans and incentives. You can review and adjust before submitting." size="sm"
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate({ period })}>Calculate</Button></>}>
        <Field label="Month">{(a) => <Input {...a} type="month" max={todayLocal().slice(0, 7)} value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
      </Dialog>
    </Card>
  );
}

function Components() {
  const { can, me } = useAuth();
  const { data, isLoading } = useApi<Comp[]>('/payroll/components');
  const [open, setOpen] = useState(false);
  const form = useZodForm(salaryComponentSchema, { kind: 'ALLOWANCE', code: '', label: '', amount: 0, isPercentOfBasic: false, employeeId: null, departmentId: null, isActive: true });
  const add = useAction('post', '/payroll/components', { invalidate: ['/payroll/components'], success: 'Component added', onSuccess: () => { setOpen(false); form.reset(); } });
  const nul = { setValueAs: (v: string) => (v === '' ? null : v) };
  return (
    <Card>
      <CardHeader title="Allowances & deductions" description="Included automatically in every payroll run for the people they apply to." action={can(P.PAYROLL_PROCESS) && <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Add</Button>} />
      <DataTable loading={isLoading} rows={data} rowKey={(c) => c.id} empty="No components yet" columns={[
        { key: 'l', header: 'Name', cell: (c) => <div><p className="font-medium">{c.label}</p><p className="font-mono text-xs text-muted-foreground">{c.code}</p></div> },
        { key: 'k', header: 'Type', cell: (c) => <Badge tone={c.kind === 'ALLOWANCE' ? 'success' : 'danger'}>{c.kind.toLowerCase()}</Badge> },
        { key: 'a', header: 'Amount', cell: (c) => (c.isPercentOfBasic ? `${c.amount}% of basic` : money(c.amount, me?.tenant.currency)) },
        { key: 's', header: 'Applies to', cell: (c) => c.employeeName ?? c.departmentName ?? 'Everyone' },
        { key: 'x', header: '', cell: (c) => <div className="flex items-center justify-end gap-1">{!c.isActive && <Badge>inactive</Badge>}<DeleteButton iconOnly path={`/payroll/components/${c.id}`} what={`"${c.label}"`} invalidate={['/payroll/components']} /></div> },
      ]} />
      <Dialog open={open} onOpenChange={setOpen} title="Add allowance or deduction" footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={add.isPending} onClick={form.handleSubmit((v) => add.mutate(v))}>Add</Button></>}>
        <div className="space-y-4">
          <FormGrid>
            <Field label="Type">{(a) => <Select {...a} {...form.register('kind')}><option value="ALLOWANCE">Allowance</option><option value="DEDUCTION">Deduction</option></Select>}</Field>
            <Field label="Code" required error={fieldError(form, 'code')} hint="e.g. HOUSE_RENT">{(a) => <Input {...a} {...form.register('code')} />}</Field>
          </FormGrid>
          <Field label="Label on salary slip" required error={fieldError(form, 'label')}>{(a) => <Input {...a} {...form.register('label')} />}</Field>
          <FormGrid>
            <Field label="Amount" required error={fieldError(form, 'amount')}>{(a) => <Input {...a} type="number" step="0.01" {...form.register('amount', { valueAsNumber: true })} />}</Field>
            <Checkbox className="mt-7" label="Percentage of basic salary" {...form.register('isPercentOfBasic')} />
          </FormGrid>
          <FormGrid>
            <Field label="Only for department">{(a) => <DepartmentSelect {...a} includeAll="All departments" {...form.register('departmentId', nul)} />}</Field>
            <Field label="Only for employee">{(a) => <EmployeeSelect {...a} placeholder="All employees" value={(form.watch('employeeId') as string | null | undefined) ?? ''} onChange={(e) => form.setValue('employeeId', (e.target.value || null) as never, { shouldDirty: true, shouldValidate: true })} />}</Field>
          </FormGrid>
        </div>
      </Dialog>
    </Card>
  );
}

export default function PayrollPage() {
  return (
    <>
      <PageHeader title="Payroll" description="Working-hours-based salaries with two-stage approval (HR, then Operations)." />
      <Tabs tabs={[
        { value: 'runs', label: 'Payroll runs', content: <Runs /> },
        { value: 'components', label: 'Allowances & deductions', content: <Components /> },
      ]} />
    </>
  );
}
