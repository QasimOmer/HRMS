'use client';

import { EMPLOYMENT_STATUSES, HIERARCHY_LABELS, HIERARCHY_TIERS, PERMISSIONS as P, ROLE_LABELS, ROLES, canAssignRole, employeeSchema, type Paginated } from '@hrms/shared';
import { Search, UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { DepartmentSelect, EmployeeSelect, useLevels } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Avatar, Card, PageHeader, StatusBadge } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select, CompanyEmailInput } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { DataTable, Pagination } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { date, money, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { EmployeeDetail } from '../profile/page';

function AddEmployeeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const form = useZodForm(employeeSchema, { roles: ['EMPLOYEE'], sendInvite: true, mustChangePassword: true, hierarchyTier: 'MEMBER', joiningDate: todayLocal() } as never);
  const dept = form.watch('departmentId') as string | undefined;
  const levelId = form.watch('levelId') as string | undefined;
  const roles = (form.watch('roles') as string[] | undefined) ?? [];
  const { data: levels } = useLevels(dept || undefined);
  const level = levels?.find((l) => l.id === levelId);

  // B7: selecting a level fills in its default salary (HR can still edit it).
  useEffect(() => {
    if (level) {
      form.setValue('basicSalary', level.defaultSalary as never);
      form.setValue('designation', level.title as never, { shouldValidate: form.formState.isSubmitted });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId]);

  const sendInvite = form.watch('sendInvite') as boolean | undefined;
  const onSubmit = form.handleSubmit(async (v) => {
    if (!v.sendInvite && !v.password) {
      form.setError('password', { message: 'Set a password, or tick "Email an invitation"' });
      return;
    }
    try {
      const r = await api.post<{ id: string }>('/employees', v.sendInvite ? { ...v, password: undefined } : v);
      toast.success(v.sendInvite ? 'Employee added and invitation sent' : 'Employee added. Share the password with them securely.');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/employees') || q.queryKey[0] === '/directory' });
      onOpenChange(false);
      form.reset();
      router.push(`/employees/${r.id}`);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });

  const assignable = ROLES.filter((r) => r !== 'EMPLOYEE' && canAssignRole(me?.user.roles ?? [], r));
  const toggleRole = (r: string) => form.setValue('roles', (roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r]) as never);
  const empty = { setValueAs: (v: string) => (v === '' ? undefined : v) };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add employee"
      description="Creates the profile and a login account. They'll receive an email to set their password."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} loading={form.formState.isSubmitting}>Add employee</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <FormGrid>
          <Field label="Full name" required error={fieldError(form, 'fullName')}>{(a) => <Input {...a} {...form.register('fullName')} />}</Field>
          <Field label="Company email" required error={fieldError(form, 'email')} hint={me?.tenant.emailDomain ? 'Type the name part only, e.g. ali.khan' : undefined}>{(a) => <CompanyEmailInput {...a} domain={me?.tenant.emailDomain} value={form.watch('email') as string | undefined} onChange={(v) => form.setValue('email', v as never, { shouldValidate: form.formState.isSubmitted })} />}</Field>
          <Field label="Department" required error={fieldError(form, 'departmentId')}>{(a) => <DepartmentSelect {...a} {...form.register('departmentId')} />}</Field>
          <Field label="Level" required error={fieldError(form, 'levelId')}>
            {(a) => (
              <Select {...a} disabled={!dept} {...form.register('levelId')}>
                <option value="">{dept ? 'Select level…' : 'Pick a department first'}</option>
                {levels?.filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id}>{l.code} – {l.title}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Designation" required error={fieldError(form, 'designation')} hint="Set by the level">{(a) => <Input {...a} readOnly tabIndex={-1} className="cursor-not-allowed bg-muted text-muted-foreground" placeholder="Pick a level" {...form.register('designation')} />}</Field>
          <Field
            label="Basic salary"
            error={fieldError(form, 'basicSalary')}
            hint={level ? `Level default ${money(level.defaultSalary, me?.tenant.currency)}${level.minSalary ? ` · range ${money(level.minSalary)}–${money(level.maxSalary)}` : ''}` : 'Fills in from the level'}
          >
            {(a) => <Input {...a} type="number" min={0} step="100" {...form.register('basicSalary', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })} />}
          </Field>
          <Field label="Joining date" required error={fieldError(form, 'joiningDate')}>{(a) => <Input {...a} type="date" {...form.register('joiningDate')} />}</Field>
          <Field label="Date of birth" error={fieldError(form, 'dateOfBirth')} hint="Used for birthday wishes (year is never shown)">{(a) => <Input {...a} type="date" {...form.register('dateOfBirth', empty)} />}</Field>
          <Field label="Reporting manager" error={fieldError(form, 'reportingManagerId')}>{(a) => <EmployeeSelect {...a} placeholder="None" value={(form.watch('reportingManagerId') as string | null | undefined) ?? ''} onChange={(e) => form.setValue('reportingManagerId', (e.target.value || undefined) as never, { shouldDirty: true, shouldValidate: true })} />}</Field>
          <Field label="Hierarchy" hint="Position in the org chart">
            {(a) => (
              <Select {...a} {...form.register('hierarchyTier')}>
                {HIERARCHY_TIERS.map((t) => <option key={t} value={t}>{HIERARCHY_LABELS[t]}</option>)}
              </Select>
            )}
          </Field>
        </FormGrid>
        {assignable.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Additional roles</legend>
            <div className="flex flex-wrap gap-4">
              {assignable.map((r) => <Checkbox key={r} label={ROLE_LABELS[r]} checked={roles.includes(r)} onChange={() => toggleRole(r)} />)}
            </div>
          </fieldset>
        )}
        <Checkbox label="Eligible for medical claims" {...form.register('medicalEligible')} />
        <Checkbox label="Email an invitation to set their password" {...form.register('sendInvite')} />
        {sendInvite === false && (
          <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
            <Field label="Password" required error={fieldError(form, 'password')} hint="At least 12 characters with upper and lower case letters and a number.">
              {(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('password', { setValueAs: (x) => (x === '' ? undefined : x) })} />}
            </Field>
            <Checkbox label="Ask them to choose their own password at first sign-in" {...form.register('mustChangePassword')} />
          </div>
        )}
      </form>
    </Dialog>
  );
}

export default function EmployeesPage() {
  const router = useRouter();
  const { can, me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  // Everyone by default (active first); former employees stay listed until deleted.
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data, isLoading, error } = useApi<Paginated<EmployeeDetail>>(`/employees${qs({ page, pageSize: 25, search: q, departmentId, status })}`);

  return (
    <>
      <PageHeader
        title="Employee profiles"
        description={can(P.EMPLOYEES_READ_ALL) ? 'Everyone in your organisation.' : 'Members of the teams you lead.'}
        actions={can(P.EMPLOYEES_MANAGE) && <Button onClick={() => setOpen(true)}><UserPlus className="h-4 w-4" /> Add employee</Button>}
      />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input className="pl-9" placeholder="Search name, email or ID…" aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <DepartmentSelect includeAll="All departments" aria-label="Department" className="w-auto" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} />
          <Select aria-label="Status" className="w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
          </Select>
        </div>
        <DataTable
          loading={isLoading}
          error={error}
          rows={data?.items}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/employees/${r.id}`)}
          empty="No employees found"
          columns={[
            {
              key: 'name',
              header: 'Employee',
              cell: (r) => (
                <div className="flex items-center gap-3">
                  <Avatar name={r.fullName} fileId={r.avatarFileId} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{r.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                  </div>
                </div>
              ),
            },
            { key: 'id', header: 'ID', cell: (r) => <span className="font-mono text-xs">{r.employeeCode}</span>, hideOnMobile: true },
            { key: 'role', header: 'Position', cell: (r) => <div><p>{r.designation}</p><p className="text-xs text-muted-foreground">{r.departmentName} · {r.levelCode}</p></div> },
            { key: 'joined', header: 'Joined', cell: (r) => date(r.joiningDate), hideOnMobile: true },
            ...(can(P.EMPLOYEES_READ_ALL) ? [{ key: 'salary', header: 'Basic salary', cell: (r: EmployeeDetail) => <span className="tabular-nums">{money(r.basicSalary, me?.tenant.currency)}</span>, hideOnMobile: true }] : []),
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.employmentStatus} /> },
          ]}
        />
        {data && <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />}
      </Card>
      {can(P.EMPLOYEES_MANAGE) && <AddEmployeeDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}
