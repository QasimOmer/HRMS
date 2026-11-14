'use client';

import { BLOOD_GROUPS, changePasswordSchema, resignationSchema, selfProfileSchema, joinedLabel } from '@hrms/shared';
import { Camera, Lock } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CareerTimeline, DocumentsPanel } from '@/components/employee-panels';
import { Button } from '@/components/ui/button';
import { Avatar, Badge, Card, CardBody, CardHeader, KeyValue, PageHeader, Skeleton, StatusBadge } from '@/components/ui/display';
import { Field, FormGrid, Input, Select, Textarea, CnicInput, PhoneInput } from '@/components/ui/form';
import { Tabs } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors, fieldError, useZodForm } from '@/lib/form';
import { date, money } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { IdCard, useIdCardContext } from '@/components/id-card';

export interface EmployeeDetail {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string;
  cnic: string | null;
  fatherName: string | null;
  fatherCnic: string | null;
  bloodGroup: string | null;
  emergencyContact: string | null;
  contactNo: string | null;
  dateOfBirth: string | null;
  medicalEligible?: boolean;
  avatarFileId: string | null;
  departmentId: string;
  departmentName: string;
  levelId: string;
  levelCode: string;
  levelTitle: string;
  designation: string;
  reportingManagerId: string | null;
  reportingManagerName: string | null;
  hierarchyTier: string;
  joiningDate: string;
  exitDate: string | null;
  employmentStatus: string;
  basicSalary: number | null;
  workScheduleId: string | null;
  team: { teamId: string; teamName: string } | null;
  roles: string[];
  accountStatus: string | null;
  tenure: string;
  createdAt?: string;
  userId: string | null;
}

function PersonalForm({ emp }: { emp: EmployeeDetail }) {
  const qc = useQueryClient();
  const form = useZodForm(selfProfileSchema.partial(), {
    fullName: emp.fullName,
    cnic: emp.cnic ?? undefined,
    fatherName: emp.fatherName ?? undefined,
    fatherCnic: emp.fatherCnic ?? undefined,
    bloodGroup: (emp.bloodGroup as (typeof BLOOD_GROUPS)[number]) ?? undefined,
    emergencyContact: emp.emergencyContact ?? undefined,
    contactNo: emp.contactNo ?? undefined,
  });
  const onSubmit = form.handleSubmit(async (v) => {
    const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '' && x !== undefined));
    try {
      await api.patch('/me/profile', clean);
      toast.success('Profile updated');
      qc.invalidateQueries({ queryKey: ['/me/profile'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });
  const empty = { setValueAs: (v: string) => (v === '' ? undefined : v) };
  return (
    <form onSubmit={onSubmit} noValidate>
      <CardBody>
        <FormGrid>
          <Field label="Full name" error={fieldError(form, 'fullName')}>{(a) => <Input {...a} {...form.register('fullName')} />}</Field>
          <Field label="CNIC number" error={fieldError(form, 'cnic')} hint="e.g. 35202-1234567-1">{(a) => <CnicInput {...a} {...form.register('cnic', empty)} />}</Field>
          <Field label="Father's name" error={fieldError(form, 'fatherName')}>{(a) => <Input {...a} {...form.register('fatherName', empty)} />}</Field>
          <Field label="Father's CNIC" error={fieldError(form, 'fatherCnic')}>{(a) => <CnicInput {...a} {...form.register('fatherCnic', empty)} />}</Field>
          <Field label="Blood group" error={fieldError(form, 'bloodGroup')}>
            {(a) => (
              <Select {...a} {...form.register('bloodGroup', empty)}>
                <option value="">Select…</option>
                {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Contact number" error={fieldError(form, 'contactNo')}>{(a) => <PhoneInput {...a} {...form.register('contactNo', empty)} />}</Field>
          <Field label="Emergency contact number" error={fieldError(form, 'emergencyContact')}>{(a) => <PhoneInput {...a} {...form.register('emergencyContact', empty)} />}</Field>
        </FormGrid>
        <div className="mt-5 flex justify-end">
          <Button type="submit" loading={form.formState.isSubmitting}>Save changes</Button>
        </div>
      </CardBody>
    </form>
  );
}

function SecurityPanel({ forced }: { forced: boolean }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const form = useZodForm(changePasswordSchema, { currentPassword: '', newPassword: '' });
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await api.post('/auth/change-password', v);
      toast.success('Password changed. Other sessions were signed out.');
      form.reset();
      await refresh();
      if (forced) router.replace('/dashboard');
    } catch (e) {
      if (!applyServerErrors(form, e)) toast.error((e as Error).message);
    }
  });
  return (
    <Card>
      <CardHeader title="Change password" description="Changing your password signs you out on all other devices." />
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="max-w-md space-y-4">
          {forced && <div role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Your password was set by an administrator. Please choose your own to continue.</div>}
          <Field label="Current password" error={fieldError(form, 'currentPassword')}>{(a) => <Input {...a} type="password" autoComplete="current-password" {...form.register('currentPassword')} />}</Field>
          <Field label="New password" error={fieldError(form, 'newPassword')} hint="At least 12 characters with upper and lower case letters and a number.">{(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('newPassword')} />}</Field>
          <Button type="submit" loading={form.formState.isSubmitting}><Lock className="h-4 w-4" /> Update password</Button>
        </CardBody>
      </form>
    </Card>
  );
}

interface Resignation { id: string; reason: string; requestedLastWorkingDate: string; approvedLastWorkingDate: string | null; status: string; currentStep: string | null; createdAt: string; employeeId: string }

function ResignationPanel({ employeeId }: { employeeId: string }) {
  const { data } = useApi<Resignation[]>('/resignations');
  const mine = data?.filter((r) => r.employeeId === employeeId) ?? [];
  const form = useZodForm(resignationSchema, { reason: '', requestedLastWorkingDate: '' });
  const submit = useAction('post', '/resignations', { invalidate: ['/resignations'], success: 'Resignation submitted to your Team Lead' });
  const withdraw = useAction<string>('post', (id) => `/resignations/${id}/withdraw`, { invalidate: ['/resignations'], success: 'Resignation withdrawn' });
  const active = mine.find((r) => r.status === 'PENDING' || r.status === 'APPROVED');
  return (
    <Card>
      <CardHeader title="Resignation" description="Reviewed by your Team Lead, then approved by HR." />
      <CardBody className="space-y-4">
        {mine.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <div>
              <p>Last working day: <strong>{date(r.approvedLastWorkingDate ?? r.requestedLastWorkingDate)}</strong></p>
              <p className="text-xs text-muted-foreground">Submitted {date(r.createdAt)}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={r.status} step={r.currentStep} />
              {r.status === 'PENDING' && <Button size="sm" variant="outline" onClick={() => withdraw.mutate(r.id)}>Withdraw</Button>}
            </div>
          </div>
        ))}
        {!active && (
          <form onSubmit={form.handleSubmit((v) => submit.mutate(v))} className="max-w-lg space-y-4" noValidate>
            <Field label="Requested last working day" error={fieldError(form, 'requestedLastWorkingDate')}>{(a) => <Input {...a} type="date" {...form.register('requestedLastWorkingDate')} />}</Field>
            <Field label="Reason" error={fieldError(form, 'reason')}>{(a) => <Textarea {...a} rows={4} {...form.register('reason')} />}</Field>
            <Button type="submit" variant="danger" loading={submit.isPending}>Submit resignation</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

/** The employee's own ID card, from the company's template; download or print. */
function MyIdCard({ emp }: { emp: EmployeeDetail }) {
  const { template, company } = useIdCardContext();
  return (
    <Card>
      <CardHeader title="Your ID card" description="Issued when you joined. Download it as a PDF (front and back) or print it; ask HR if anything on it is wrong." />
      <CardBody><IdCard person={emp} template={template} company={company} /></CardBody>
    </Card>
  );
}

function ProfileInner() {
  const params = useSearchParams();
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const { data: emp, isLoading } = useApi<EmployeeDetail>(me?.employee ? '/me/profile' : null);
  const fileRef = useRef<HTMLInputElement>(null);
  const forced = params.get('force') === '1' || !!me?.user.mustChangePassword;
  const tab = params.get('tab') ?? (forced ? 'security' : 'profile');

  useEffect(() => {
    // Fixed id: re-renders or revisits update the same toast instead of stacking copies.
    if (forced) toast.message('Please change your password to continue', { id: 'must-change-password' });
  }, [forced]);

  const uploadAvatar = async (f: File) => {
    const fd = new FormData();
    fd.set('file', f);
    try {
      await api.put('/me/avatar', fd);
      toast.success('Photo updated');
      qc.invalidateQueries({ queryKey: ['/me/profile'] });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!me?.employee) {
    return (
      <>
        <PageHeader title="My account" />
        <SecurityPanel forced={forced} />
      </>
    );
  }
  if (isLoading || !emp) return <Skeleton className="h-96" />;

  return (
    <>
      <PageHeader title="My profile" />
      <Card className="mb-6">
        <CardBody className="flex flex-wrap items-center gap-5">
          <div className="relative">
            <Avatar name={emp.fullName} fileId={emp.avatarFileId} size="xl" />
            <button
              className="absolute -right-1 -bottom-1 rounded-full border bg-card p-1.5 shadow hover:bg-muted"
              onClick={() => fileRef.current?.click()}
              aria-label="Change profile photo"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold">{emp.fullName}</h2>
            <p className="text-sm text-muted-foreground">{emp.designation} · {emp.departmentName}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="primary">{emp.levelCode} – {emp.levelTitle}</Badge>
              <Badge>{emp.employeeCode}</Badge>
              <span title={emp.tenure}><Badge tone="info">{joinedLabel(emp.joiningDate)}</Badge></span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Tabs
        defaultValue={tab}
        tabs={[
          {
            value: 'profile',
            label: 'Profile',
            content: (
              <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader title="Personal information" description="You can update these details yourself." />
                  <PersonalForm emp={emp} />
                </Card>
                <Card>
                  <CardHeader title="Employment" description="Managed by HR." />
                  <CardBody>
                    <KeyValue
                      items={[
                        ['Employee ID', emp.employeeCode],
                        ['Company email', emp.email],
                        ['Department', emp.departmentName],
                        ['Designation', emp.designation],
                        ['Level', `${emp.levelCode} – ${emp.levelTitle}`],
                        ['Reporting manager', emp.reportingManagerName],
                        ['Team', emp.team?.teamName],
                        ['Joining date', date(emp.joiningDate)],
                        ['Basic salary', money(emp.basicSalary, me.tenant.currency)],
                      ]}
                    />
                  </CardBody>
                </Card>
              </div>
            ),
          },
          { value: 'documents', label: 'Documents', content: <DocumentsPanel employeeId={emp.id} self /> },
          { value: 'id-card', label: 'ID card', content: <MyIdCard emp={emp} /> },
          { value: 'career', label: 'Career', content: <CareerTimeline employeeId={emp.id} currency={me.tenant.currency} alwaysShow /> },
          { value: 'resignation', label: 'Resignation', content: <ResignationPanel employeeId={emp.id} /> },
          { value: 'security', label: 'Security', content: <SecurityPanel forced={forced} /> },
        ]}
      />
    </>
  );
}

export default function ProfilePage() {
  return (
    <Suspense>
      <ProfileInner />
    </Suspense>
  );
}
