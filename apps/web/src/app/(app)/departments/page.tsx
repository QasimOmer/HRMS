'use client';

import { departmentSchema, levelSchema } from '@hrms/shared';
import { ArrowDown, ArrowUp, Building2, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { EmployeeSelect, useDepartments, useLevels, type Department, type Level } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, LoadingRows, PageHeader } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { cn, money } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { DeleteButton } from '@/components/delete-button';

function DepartmentDialog({ dept, open, onOpenChange }: { dept?: Department; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const form = useZodForm(departmentSchema);
  const { data: schedules } = useApi<{ id: string; name: string; startTime: string; endTime: string }[]>(open ? '/work-schedules' : null);
  useEffect(() => {
    if (open) form.reset(dept ? { name: dept.name, code: dept.code, headEmployeeId: dept.headEmployeeId, foodAllowanceEnabled: dept.foodAllowanceEnabled, paidOvertimeEnabled: dept.paidOvertimeEnabled, workScheduleId: dept.workScheduleId, isActive: dept.isActive } : { name: '', code: '', headEmployeeId: null, foodAllowanceEnabled: false, paidOvertimeEnabled: false, workScheduleId: null, isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dept]);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (dept) await api.put(`/departments/${dept.id}`, v);
      else await api.post('/departments', v);
      toast.success(dept ? 'Department updated' : 'Department created with a default L0–L6 ladder');
      qc.invalidateQueries({ predicate: (q) => ['/departments', '/levels'].some((p) => String(q.queryKey[0]).startsWith(p)) });
      onOpenChange(false);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={dept ? 'Edit department' : 'New department'} footer={<>{dept && <span className="mr-auto"><DeleteButton path={`/departments/${dept.id}`} what={`the ${dept.name} department`} invalidate={['/departments', '/levels']} onDeleted={() => onOpenChange(false)} detail="Only possible if nobody ever belonged to it. Its levels are deleted too. Otherwise untick Active." /></span>}<Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSubmit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} {...form.register('name')} />}</Field>
          <Field label="Code" required error={fieldError(form, 'code')} hint="e.g. SALES">{(a) => <Input {...a} {...form.register('code')} />}</Field>
        </FormGrid>
        <Field label="Head of department">{(a) => <EmployeeSelect {...a} placeholder="None" value={(form.watch('headEmployeeId') as string | null | undefined) ?? ''} onChange={(e) => form.setValue('headEmployeeId', (e.target.value || null) as never, { shouldDirty: true, shouldValidate: true })} />}</Field>
        <Field label="Shift hours" hint="Late minutes and overtime are counted from this shift. No grace period.">{(a) => (
          <Select {...a} {...form.register('workScheduleId', { setValueAs: (v) => (v === '' ? null : v) })}>
            <option value="">Company default</option>
            {schedules?.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)})</option>)}
          </Select>
        )}</Field>
        <div className="flex flex-col gap-2">
          <Checkbox label="Food allowance enabled (D4)" {...form.register('foodAllowanceEnabled')} />
          <Checkbox label="Paid overtime compensation available (C2)" {...form.register('paidOvertimeEnabled')} />
          <Checkbox label="Active" {...form.register('isActive')} />
        </div>
      </div>
    </Dialog>
  );
}

function LevelDialog({ departmentId, level, open, onOpenChange, currency }: { departmentId: string; level?: Level; open: boolean; onOpenChange: (o: boolean) => void; currency: string }) {
  const qc = useQueryClient();
  const form = useZodForm(levelSchema);
  useEffect(() => {
    if (open) form.reset(level ? { departmentId, code: level.code, title: level.title, description: level.description ?? undefined, defaultSalary: level.defaultSalary, minSalary: level.minSalary ?? undefined, maxSalary: level.maxSalary ?? undefined, isActive: level.isActive } : { departmentId, code: '', title: '', defaultSalary: 0, isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, level]);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      if (level) await api.patch(`/levels/${level.id}`, { title: v.title, description: v.description, defaultSalary: v.defaultSalary, minSalary: v.minSalary ?? null, maxSalary: v.maxSalary ?? null, isActive: v.isActive });
      else await api.post('/levels', v);
      toast.success(level ? 'Level updated. New default salary applies to new assignments only.' : 'Level added');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/levels') });
      onOpenChange(false);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });
  const num = { setValueAs: (v: string) => (v === '' ? undefined : Number(v)) };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={level ? `Edit ${level.code}` : 'Add level'} description={`Salaries in ${currency}. Changing the default does not change existing employees' salaries.`}
      footer={<>{level && <span className="mr-auto"><DeleteButton path={`/levels/${level.id}`} what={`level ${level.code}`} invalidate={['/levels', '/departments']} onDeleted={() => onOpenChange(false)} detail="Only possible if no employee has ever held this level. Otherwise untick Active." /></span>}<Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSubmit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Code" required error={fieldError(form, 'code')} hint="L0, L1, …">{(a) => <Input {...a} disabled={!!level} {...form.register('code')} />}</Field>
          <Field label="Title" required error={fieldError(form, 'title')}>{(a) => <Input {...a} {...form.register('title')} />}</Field>
        </FormGrid>
        <Field label="Description">{(a) => <Textarea {...a} rows={2} {...form.register('description')} />}</Field>
        <FormGrid cols={3}>
          <Field label="Default salary" required error={fieldError(form, 'defaultSalary')}>{(a) => <Input {...a} type="number" {...form.register('defaultSalary', num)} />}</Field>
          <Field label="Minimum" error={fieldError(form, 'minSalary')}>{(a) => <Input {...a} type="number" {...form.register('minSalary', num)} />}</Field>
          <Field label="Maximum" error={fieldError(form, 'maxSalary')}>{(a) => <Input {...a} type="number" {...form.register('maxSalary', num)} />}</Field>
        </FormGrid>
        <Checkbox label="Active" {...form.register('isActive')} />
      </div>
    </Dialog>
  );
}

/** B7 – departments, levels (ranks) and salary bands. */
export default function DepartmentsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const currency = me?.tenant.currency ?? 'PKR';
  const { data: depts, isLoading } = useDepartments();
  const [selected, setSelected] = useState<string>('');
  const [deptDialog, setDeptDialog] = useState<{ open: boolean; dept?: Department }>({ open: false });
  const [levelDialog, setLevelDialog] = useState<{ open: boolean; level?: Level }>({ open: false });
  const current = depts?.find((d) => d.id === selected) ?? depts?.[0];
  const { data: levels, isLoading: lvLoading } = useLevels(current?.id);

  const move = async (idx: number, dir: -1 | 1) => {
    if (!levels) return;
    const ids = levels.map((l) => l.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    try {
      await api.post('/levels/reorder', { levelIds: ids });
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/levels') });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <PageHeader title="Departments & levels" description="Build your organisation: departments, the levels inside each, and the salary attached to each level." actions={<Button onClick={() => setDeptDialog({ open: true })}><Plus className="h-4 w-4" /> New department</Button>} />
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          {isLoading ? <LoadingRows rows={4} /> : !depts?.length ? <EmptyState icon={Building2} title="No departments" /> : (
            <ul className="p-2">
              {depts.map((d) => (
                <li key={d.id}>
                  <button onClick={() => setSelected(d.id)} aria-current={current?.id === d.id} className={cn('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted', current?.id === d.id && 'bg-primary-soft font-medium text-primary')}>
                    <span className="truncate">{d.name}</span>
                    <span className="flex items-center gap-1.5">
                      {!d.isActive && <Badge>inactive</Badge>}
                      <span className="text-xs text-muted-foreground tabular-nums">{d.activeEmployees}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {current && (
          <Card>
            <CardHeader
              title={`${current.name} (${current.code})`}
              description={`Head: ${current.headName ?? 'not set'} · ${current.foodAllowanceEnabled ? 'Food allowance on' : 'No food allowance'} · ${current.paidOvertimeEnabled ? 'Paid overtime' : 'No paid overtime'}`}
              action={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDeptDialog({ open: true, dept: current })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                  <Button size="sm" onClick={() => setLevelDialog({ open: true })}><Plus className="h-3.5 w-3.5" /> Add level</Button>
                </div>
              }
            />
            <DataTable
              loading={lvLoading}
              rows={levels}
              rowKey={(l) => l.id}
              empty="No levels yet"
              columns={[
                { key: 'order', header: <span className="sr-only">Order</span>, className: 'w-16', cell: (l) => { const i = levels!.indexOf(l); return <div className="flex"><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${l.code} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${l.code} down`} disabled={i === levels!.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button></div>; } },
                { key: 'code', header: 'Level', cell: (l) => <span className="font-mono font-medium">{l.code}</span> },
                { key: 'title', header: 'Title', cell: (l) => <div><p>{l.title}</p>{l.description && <p className="text-xs text-muted-foreground">{l.description}</p>}</div> },
                { key: 'salary', header: 'Default salary', cell: (l) => <span className="tabular-nums">{money(l.defaultSalary, currency)}</span> },
                { key: 'range', header: 'Range', hideOnMobile: true, cell: (l) => <span className="text-xs text-muted-foreground tabular-nums">{l.minSalary != null ? `${money(l.minSalary)} – ${money(l.maxSalary)}` : '—'}</span> },
                { key: 'status', header: '', cell: (l) => (!l.isActive ? <Badge>inactive</Badge> : null) },
                { key: 'edit', header: <span className="sr-only">Edit</span>, cell: (l) => <Button size="icon" variant="ghost" aria-label={`Edit ${l.code}`} onClick={() => setLevelDialog({ open: true, level: l })}><Pencil className="h-4 w-4" /></Button> },
              ]}
            />
          </Card>
        )}
      </div>
      <DepartmentDialog {...deptDialog} onOpenChange={(o) => setDeptDialog((s) => ({ ...s, open: o }))} />
      {current && <LevelDialog departmentId={current.id} currency={currency} {...levelDialog} onOpenChange={(o) => setLevelDialog((s) => ({ ...s, open: o }))} />}
    </>
  );
}
