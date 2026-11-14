'use client';

import { BLOOD_GROUPS, EMPLOYMENT_STATUSES, HIERARCHY_LABELS, HIERARCHY_TIERS, PERMISSIONS as P, phoneProblem, promotionSchema, joinedLabel } from '@hrms/shared';
import { ArrowLeft, BadgeCheck, Camera, Info, Pencil, UserCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DeleteButton } from '@/components/delete-button';
import { DepartmentSelect, EmployeeSelect, useLevels } from '@/components/domain';
import { CareerTimeline, DocumentsPanel } from '@/components/employee-panels';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, CardHeader, ErrorState, KeyValue, Skeleton, StatusBadge } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Select, Textarea, CnicInput, PhoneInput, CompanyEmailInput } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { date, hours, money, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { EmployeeDetail } from '../../profile/page';
import { IdCard, useIdCardContext } from '@/components/id-card';

function EmployeeIdCard({ emp }: { emp: EmployeeDetail }) {
  const { template, company } = useIdCardContext();
  return (
    <Card>
      <CardHeader title="ID card" description="Uses the company's ID card template (Settings → ID card)." />
      <CardBody><IdCard person={emp} template={template} company={company} /></CardBody>
    </Card>
  );
}

function EditDialog({ emp, open, onOpenChange }: { emp: EmployeeDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [v, setV] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const { data: levels } = useLevels((v.departmentId as string) ?? emp.departmentId);
  useEffect(() => {
    if (open)
      setV({
        fullName: emp.fullName, email: emp.email, designation: emp.designation, departmentId: emp.departmentId, levelId: emp.levelId,
        basicSalary: emp.basicSalary, joiningDate: emp.joiningDate, dateOfBirth: emp.dateOfBirth ?? '', reportingManagerId: emp.reportingManagerId ?? '',
        hierarchyTier: emp.hierarchyTier, employmentStatus: emp.employmentStatus, cnic: emp.cnic ?? '', fatherName: emp.fatherName ?? '',
        fatherCnic: emp.fatherCnic ?? '', bloodGroup: emp.bloodGroup ?? '', contactNo: emp.contactNo ?? '', emergencyContact: emp.emergencyContact ?? '',
        medicalEligible: !!emp.medicalEligible,
      });
  }, [open, emp]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== '' && x !== undefined)
          .map(([k, x]) => [k, k === 'basicSalary' ? Number(x) : x]),
      );
      if (v.reportingManagerId === '') body.reportingManagerId = null;
      await api.patch(`/employees/${emp.id}`, body);
      toast.success('Employee updated');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/employees') });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const s = (k: string) => String(v[k] ?? '');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Edit employee" description="Company Admin and HR can edit every field, including ones employees can't change. Setting the status back to Active restores their login." size="xl"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} loading={busy} disabled={!!(phoneProblem(s('contactNo')) || phoneProblem(s('emergencyContact')))}>Save</Button></>}>
      <FormGrid cols={3}>
        <Field label="Full name">{(a) => <Input {...a} value={s('fullName')} onChange={set('fullName')} />}</Field>
        <Field label="Company email">{(a) => <CompanyEmailInput {...a} domain={me?.tenant.emailDomain} domains={me?.tenant.emailDomains} value={s('email')} onChange={(v) => setV((x) => ({ ...x, email: v }))} />}</Field>
        <Field label="Designation">{(a) => <Input {...a} value={s('designation')} onChange={set('designation')} />}</Field>
        <Field label="Department">{(a) => <DepartmentSelect {...a} value={s('departmentId')} onChange={(e) => setV((x) => ({ ...x, departmentId: e.target.value, levelId: '' }))} />}</Field>
        <Field label="Level" hint="Choosing a level fills in its default salary">{(a) => <Select {...a} value={s('levelId')} onChange={(e) => { const l = levels?.find((x) => x.id === e.target.value); setV((x) => ({ ...x, levelId: e.target.value, ...(l ? { basicSalary: l.defaultSalary } : {}) })); }}><option value="">Select…</option>{levels?.map((l) => <option key={l.id} value={l.id}>{l.code} – {l.title}</option>)}</Select>}</Field>
        <Field label="Basic salary">{(a) => <Input {...a} type="number" value={s('basicSalary')} onChange={set('basicSalary')} />}</Field>
        <Field label="Joining date">{(a) => <Input {...a} type="date" value={s('joiningDate')} onChange={set('joiningDate')} />}</Field>
        <Field label="Date of birth">{(a) => <Input {...a} type="date" value={s('dateOfBirth')} onChange={set('dateOfBirth')} />}</Field>
        <Field label="Status">{(a) => <Select {...a} value={s('employmentStatus')} onChange={set('employmentStatus')}>{EMPLOYMENT_STATUSES.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
        <Field label="Reporting manager">{(a) => <EmployeeSelect {...a} placeholder="None" value={s('reportingManagerId')} onChange={set('reportingManagerId')} filter={(e) => e.id !== emp.id} />}</Field>
        <Field label="Hierarchy">{(a) => <Select {...a} value={s('hierarchyTier')} onChange={set('hierarchyTier')}>{HIERARCHY_TIERS.map((t) => <option key={t} value={t}>{HIERARCHY_LABELS[t]}</option>)}</Select>}</Field>
        <Field label="Blood group">{(a) => <Select {...a} value={s('bloodGroup')} onChange={set('bloodGroup')}><option value="">—</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}</Select>}</Field>
        <Field label="CNIC">{(a) => <CnicInput {...a} value={s('cnic')} onChange={set('cnic')} />}</Field>
        <Field label="Father's name">{(a) => <Input {...a} value={s('fatherName')} onChange={set('fatherName')} />}</Field>
        <Field label="Father's CNIC">{(a) => <CnicInput {...a} value={s('fatherCnic')} onChange={set('fatherCnic')} />}</Field>
        <Field label="Contact number" error={phoneProblem(s('contactNo')) ?? undefined}>{(a) => <PhoneInput {...a} value={s('contactNo')} onChange={set('contactNo')} />}</Field>
        <Field label="Emergency contact" error={phoneProblem(s('emergencyContact')) ?? undefined}>{(a) => <PhoneInput {...a} value={s('emergencyContact')} onChange={set('emergencyContact')} />}</Field>
      </FormGrid>
      <div className="mt-5 border-t pt-4">
        <Checkbox label="Eligible for medical claims" checked={!!v.medicalEligible} onChange={(e) => setV((x) => ({ ...x, medicalEligible: e.target.checked }))} />
        <p className="mt-1 ml-6 text-xs text-muted-foreground">They can claim medical expenses up to the company's yearly limit. Without this, Medical claims is hidden for them.</p>
      </div>
    </Dialog>
  );
}

function PromoteDialog({ emp, open, onOpenChange, currency }: { emp: EmployeeDetail; open: boolean; onOpenChange: (o: boolean) => void; currency: string }) {
  const qc = useQueryClient();
  const form = useZodForm(promotionSchema, { departmentId: emp.departmentId, effectiveDate: todayLocal() } as never);
  const dept = (form.watch('departmentId') as string) || emp.departmentId;
  const levelId = form.watch('levelId') as string;
  const { data: levels } = useLevels(dept);
  const level = levels?.find((l) => l.id === levelId);
  useEffect(() => {
    if (level) {
      form.setValue('salary', level.defaultSalary as never);
      form.setValue('designation', level.title as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelId]);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post(`/employees/${emp.id}/promotions`, v);
      toast.success('Position updated');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/employees') || q.queryKey[0] === '/promotions' });
      onOpenChange(false);
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Promote / change position" description="The salary updates to the new level's default; you can adjust it." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSubmit} loading={form.formState.isSubmitting}>Save</Button></>}>
      <FormGrid>
        <Field label="Department" error={fieldError(form, 'departmentId')}>{(a) => <DepartmentSelect {...a} {...form.register('departmentId')} />}</Field>
        <Field label="New level" required error={fieldError(form, 'levelId')}>{(a) => <Select {...a} {...form.register('levelId')}><option value="">Select…</option>{levels?.filter((l) => l.isActive).map((l) => <option key={l.id} value={l.id} disabled={l.id === emp.levelId}>{l.code} – {l.title}</option>)}</Select>}</Field>
        <Field label="Designation" error={fieldError(form, 'designation')}>{(a) => <Input {...a} {...form.register('designation')} />}</Field>
        <Field label="Salary" error={fieldError(form, 'salary')} hint={level ? `Default ${money(level.defaultSalary, currency)}` : undefined}>{(a) => <Input {...a} type="number" {...form.register('salary', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })} />}</Field>
        <Field label="Effective date" required error={fieldError(form, 'effectiveDate')}>{(a) => <Input {...a} type="date" {...form.register('effectiveDate')} />}</Field>
      </FormGrid>
      <div className="mt-4"><Field label="Notes">{(a) => <Textarea {...a} rows={2} {...form.register('notes')} />}</Field></div>
    </Dialog>
  );
}

/** Former employee comes back. Nothing was deleted, so their history is all still there. */
function ReactivateDialog({ emp, open, onOpenChange }: { emp: EmployeeDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [restoreLogin, setRestoreLogin] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ login: string }>(`/employees/${emp.id}/reactivate`, { restoreLogin });
      toast.success(r.login === 'restored' ? `${emp.fullName} is active again and can sign in` : r.login === 'invite_needed' ? `${emp.fullName} is active again. They still need to set a password from their invitation.` : `${emp.fullName} is active again`);
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/employees') });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Reactivate ${emp.fullName}?`} description="They become an active employee again with all their past records (attendance, leave, payslips, documents)." size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={go} loading={busy}><UserCheck className="h-4 w-4" /> Reactivate</Button></>}>
      {emp.accountStatus ? (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={restoreLogin} onChange={(e) => setRestoreLogin(e.target.checked)} />
          <span><span className="font-medium">Give login access again</span><span className="block text-xs text-muted-foreground">They can sign in with their existing email and password.</span></span>
        </label>
      ) : <p className="text-sm text-muted-foreground">This employee has no login account.</p>}
    </Dialog>
  );
}

function TerminateDialog({ emp, open, onOpenChange }: { emp: EmployeeDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [exitDate, setExitDate] = useState(todayLocal());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await api.post(`/employees/${emp.id}/terminate`, { exitDate, reason });
      toast.success('Employment terminated and access revoked');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/employees') });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Terminate ${emp.fullName}?`} description="Their login is disabled immediately. All their records are kept, and you can reactivate them later." size="sm"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="danger" onClick={go} loading={busy} disabled={reason.trim().length < 5}>Terminate</Button></>}>
      <div className="space-y-4">
        <Field label="Exit date">{(a) => <Input {...a} type="date" value={exitDate} onChange={(e) => setExitDate(e.target.value)} />}</Field>
        <Field label="Reason" required>{(a) => <Textarea {...a} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

interface Day { date: string; status: string; workedMinutes: number; lateMinutes: number; overtimeMinutes: number }

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const { data: emp, isLoading, error } = useApi<EmployeeDetail>(`/employees/${id}`);
  const to = todayLocal();
  const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const { data: days } = useApi<Day[]>(emp ? `/attendance/days?employeeId=${id}&from=${from}&to=${to}` : null);
  const [edit, setEdit] = useState(false);
  const [promote, setPromote] = useState(false);
  const [terminate, setTerminate] = useState(false);
  const [reactivate, setReactivate] = useState(false);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const currency = me?.tenant.currency ?? 'PKR';

  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !emp) return <Skeleton className="h-96" />;
  const hr = can(P.EMPLOYEES_MANAGE);

  const uploadAvatar = async (f: File) => {
    const fd = new FormData();
    fd.set('file', f);
    try {
      await api.put(`/employees/${id}/avatar`, fd);
      qc.invalidateQueries({ queryKey: [`/employees/${id}`] });
      toast.success('Photo updated');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Link href="/employees" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Employees</Link>
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center gap-5">
          <div className="relative">
            <Avatar name={emp.fullName} fileId={emp.avatarFileId} size="xl" />
            {hr && (
              <>
                <button className="absolute -right-1 -bottom-1 rounded-full border bg-card p-1.5 shadow hover:bg-muted" onClick={() => fileRef.current?.click()} aria-label="Change photo"><Camera className="h-3.5 w-3.5" /></button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">{emp.fullName}</h1>
            <p className="text-sm text-muted-foreground">{emp.designation} · {emp.departmentName}{emp.team ? ` · ${emp.team.teamName}` : ''}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <StatusBadge status={emp.employmentStatus} />
              <Badge tone="primary">{emp.levelCode} – {emp.levelTitle}</Badge>
              <Badge>{emp.employeeCode}</Badge>
              <span title={emp.tenure}><Badge tone="info">{joinedLabel(emp.joiningDate)}</Badge></span>
              {emp.accountStatus && <Badge tone={emp.accountStatus === 'ACTIVE' ? 'success' : 'warning'}>login {emp.accountStatus.toLowerCase()}</Badge>}
            </div>
          </div>
          {hr && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /> Edit</Button>
              {can(P.PROMOTIONS_MANAGE) && <Button variant="outline" onClick={() => setPromote(true)}><BadgeCheck className="h-4 w-4" /> Promote</Button>}
              {emp.employmentStatus === 'ACTIVE' && <Button variant="outline" className="text-danger" onClick={() => setTerminate(true)}><UserX className="h-4 w-4" /> Terminate</Button>}
              {emp.employmentStatus !== 'ACTIVE' && <Button onClick={() => setReactivate(true)}><UserCheck className="h-4 w-4" /> Reactivate</Button>}
              {emp.employmentStatus !== 'ACTIVE' && (
                <DeleteButton path={`/employees/${emp.id}`} what={emp.fullName} label="Delete permanently" invalidate={['/employees', '/dashboard']} onDeleted={() => router.replace('/employees')}
                  detail="This permanently deletes the employee and everything that belongs to them: attendance, leave, payslips, loans, documents and their login. It cannot be undone. To keep the history, leave them terminated instead." />
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {emp.employmentStatus !== 'ACTIVE' && (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            <span className="font-medium">{emp.fullName} is {emp.employmentStatus.toLowerCase().replace('_', ' ')}{emp.exitDate ? ` since ${date(emp.exitDate)}` : ''}.</span>{' '}
            Their login is disabled, but all their records are kept until someone deletes them.{hr ? ' Use Reactivate to bring them back.' : ''}
          </p>
        </div>
      )}
      <Tabs
        tabs={[
          {
            value: 'profile',
            label: 'Profile',
            content: (
              <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                  <CardHeader title="Personal" />
                  <CardBody>
                    <KeyValue items={[['Full name', emp.fullName], ['CNIC', emp.cnic ?? (hr ? null : 'Confidential')], ["Father's name", emp.fatherName], ["Father's CNIC", emp.fatherCnic ?? (hr ? null : 'Confidential')], ['Blood group', emp.bloodGroup], ['Contact', emp.contactNo], ['Emergency contact', emp.emergencyContact], ['Date of birth', emp.dateOfBirth ? date(emp.dateOfBirth, { day: 'numeric', month: 'long' }) : null]]} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Employment" />
                  <CardBody>
                    <KeyValue items={[['Employee ID', emp.employeeCode], ['Company email', emp.email], ['Department', emp.departmentName], ['Level', `${emp.levelCode} – ${emp.levelTitle}`], ['Reporting manager', emp.reportingManagerName], ['Hierarchy', HIERARCHY_LABELS[emp.hierarchyTier as keyof typeof HIERARCHY_LABELS]], ['Joined', date(emp.joiningDate)], ['Exit date', emp.exitDate ? date(emp.exitDate) : null], ['Basic salary', emp.basicSalary !== null ? money(emp.basicSalary, currency) : 'Confidential'], ['Roles', emp.roles.join(', ').toLowerCase().replace(/_/g, ' ')]]} />
                  </CardBody>
                </Card>
              </div>
            ),
          },
          { value: 'documents', label: 'Documents', hidden: !(can(P.EMPLOYEE_DOCS_MANAGE) || can(P.EMPLOYMENT_DOCS_MANAGE)), content: <DocumentsPanel employeeId={id} self={false} /> },
          { value: 'career', label: 'Promotions', content: <CareerTimeline employeeId={id} currency={currency} alwaysShow /> },
          { value: 'id-card', label: 'ID card', hidden: !hr, content: <EmployeeIdCard emp={emp} /> },
          {
            value: 'attendance',
            label: 'Attendance (30 days)',
            content: (
              <Card>
                <ul className="divide-y">
                  {!days?.length && <li className="p-5 text-sm text-muted-foreground">No attendance records in the last 30 days.</li>}
                  {days?.map((d) => (
                    <li key={d.date} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                      <span>{date(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <span className="text-muted-foreground">{hours(d.workedMinutes)}{d.overtimeMinutes ? ` · +${hours(d.overtimeMinutes)} OT` : ''}{d.lateMinutes ? ` · ${d.lateMinutes}m late` : ''}</span>
                      <StatusBadge status={d.status} />
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          },
        ]}
      />
      {hr && <EditDialog emp={emp} open={edit} onOpenChange={setEdit} />}
      {hr && <PromoteDialog emp={emp} open={promote} onOpenChange={setPromote} currency={currency} />}
      {hr && <TerminateDialog emp={emp} open={terminate} onOpenChange={setTerminate} />}
      {hr && <ReactivateDialog emp={emp} open={reactivate} onOpenChange={setReactivate} />}
    </>
  );
}
