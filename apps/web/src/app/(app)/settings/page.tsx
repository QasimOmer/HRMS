'use client';

import { BIRTHDAY_PLACEHOLDERS, DEFAULT_BIRTHDAY_BODY, DEFAULT_BIRTHDAY_TITLE, DEFAULT_ID_CARD, ID_CARD_FIELDS, ID_CARD_FIELD_LABELS, idCardTemplate, type IdCardTemplate, PERMISSIONS as P, renderBirthdayTemplate, workScheduleSchema } from '@hrms/shared';
import { Cake, ImageUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CompanyLogo } from '@/components/brand';
import { FileUpload } from '@/components/ui/file-upload';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Textarea } from '@/components/ui/form';
import { Dialog, Tabs } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fieldError, useZodForm } from '@/lib/form';
import { useAction, useApi } from '@/lib/hooks';
import { Combobox } from '@/components/ui/combobox';
import { currencyOptions, timeZoneOptions } from '@/lib/locale-options';
import { DeleteButton } from '@/components/delete-button';
import { IdCard } from '@/components/id-card';
import { todayLocal } from '@/lib/format';

interface S { name: string; slug: string; timezone: string; currency: string; settings: { directoryShowJoinDate: boolean; sessionIdleMinutes?: number; medicalAnnualLimit: number; overtimeThresholdMinutes: number; payrollWorkingHoursBased: boolean; birthdayPostTitle?: string; birthdayPostBody?: string; idCard?: Partial<IdCardTemplate> } }
interface WS { id: string; name: string; startTime: string; endTime: string; breakMinutes: number; workingDays: number[]; isDefault: boolean }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Company logo shown in everyone's sidebar. */
function CompanyLogoCard() {
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setFiles([]);
      await refresh();
      qc.invalidateQueries({ queryKey: ['/settings'] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const upload = () => {
    const fd = new FormData();
    fd.set('file', files[0]!);
    return run(() => api.put('/settings/logo', fd), 'Logo updated');
  };
  return (
    <Card>
      <CardHeader title="Company logo" description="Shown at the top of the sidebar for everyone in your company. A square PNG or JPG works best." />
      <CardBody className="space-y-4">
        <div className="flex items-center gap-4">
          <CompanyLogo name={me.tenant.name} logoFileId={me.tenant.logoFileId} className="h-16 w-16 text-xl" />
          <div className="text-sm">
            <p className="font-medium">{me.tenant.name}</p>
            <p className="text-muted-foreground">{me.tenant.logoFileId ? 'Current logo' : 'No logo yet – initials are shown instead'}</p>
          </div>
          {me.tenant.logoFileId && (
            <Button variant="ghost" size="sm" className="ml-auto text-danger" loading={busy && !files.length} onClick={() => run(() => api.del('/settings/logo'), 'Logo removed')}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          )}
        </div>
        <FileUpload value={files} onChange={setFiles} accept="image/png,image/jpeg,image/webp" maxSizeMB={2} label={me.tenant.logoFileId ? 'Choose a new logo' : 'Choose a logo'} />
        {files.length > 0 && <Button loading={busy} onClick={upload}><ImageUp className="h-4 w-4" /> Save logo</Button>}
      </CardBody>
    </Card>
  );
}

function Company() {
  const { can, refresh } = useAuth();
  const { data } = useApi<S>('/settings');
  const [v, setV] = useState<S | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const full = can(P.TENANT_SETTINGS);
  const save = useAction('patch', '/settings', {
    invalidate: ['/settings', '/directory'], success: 'Settings saved', onSuccess: () => refresh(),
    body: () => (full ? { name: v!.name, timezone: v!.timezone, currency: v!.currency, ...v!.settings } : { directoryShowJoinDate: v!.settings.directoryShowJoinDate, sessionIdleMinutes: v!.settings.sessionIdleMinutes ?? 30 }),
  });
  if (!v) return null;
  const set = (patch: Partial<S['settings']>) => setV({ ...v, settings: { ...v.settings, ...patch } });
  return (
    <Card>
      <CardHeader title="Company settings" description={`Workspace: ${v.slug}`} />
      <CardBody className="max-w-2xl space-y-5">
        {full && (
          <FormGrid cols={3}>
            <Field label="Company name">{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
            <Field label="Time zone" hint="Used for attendance, late minutes and payroll dates">{(a) => <Combobox {...a} value={v.timezone} onChange={(tz) => setV({ ...v, timezone: tz })} options={timeZoneOptions()} searchPlaceholder="Search city, region or UTC offset…" />}</Field>
            <Field label="Currency">{(a) => <Combobox {...a} value={v.currency} onChange={(c) => setV({ ...v, currency: c })} options={currencyOptions()} renderValue={(o) => o.value} searchPlaceholder="Search currency…" />}</Field>
          </FormGrid>
        )}
        {full && (
          <FormGrid>
            <Field label="Medical allowance limit per year">{(a) => <Input {...a} type="number" value={v.settings.medicalAnnualLimit} onChange={(e) => set({ medicalAnnualLimit: Number(e.target.value) })} />}</Field>
            <Field label="Minimum overtime to count (minutes)">{(a) => <Input {...a} type="number" value={v.settings.overtimeThresholdMinutes} onChange={(e) => set({ overtimeThresholdMinutes: Number(e.target.value) })} />}</Field>
          </FormGrid>
        )}
        <Field label="Sign out after inactivity (minutes)" hint="People are signed out when they haven't used the app for this long. 5–480 minutes.">{(a) => <Input {...a} type="number" min={5} max={480} className="max-w-40" value={v.settings.sessionIdleMinutes ?? 30} onChange={(e) => set({ sessionIdleMinutes: Number(e.target.value) })} />}</Field>
        <div className="flex flex-col gap-3">
          {full && <Checkbox label="Calculate salaries from actual working hours" checked={v.settings.payrollWorkingHoursBased} onChange={(e) => set({ payrollWorkingHoursBased: e.target.checked })} />}
          <Checkbox label='Show joining date in the directory (e.g. "Joined 13 November 2026")' checked={v.settings.directoryShowJoinDate} onChange={(e) => set({ directoryShowJoinDate: e.target.checked })} />
        </div>
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save settings</Button>
      </CardBody>
    </Card>
  );
}

/** G3: the birthday post the system publishes automatically, worded by the Company Admin. */
function BirthdayTemplate() {
  const { me } = useAuth();
  const { data } = useApi<S>('/settings');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [focus, setFocus] = useState<'title' | 'body'>('body');
  useEffect(() => {
    if (!data) return;
    setTitle(data.settings.birthdayPostTitle || DEFAULT_BIRTHDAY_TITLE);
    setBody(data.settings.birthdayPostBody || DEFAULT_BIRTHDAY_BODY);
  }, [data]);
  const save = useAction('patch', '/settings', { invalidate: ['/settings'], success: 'Birthday post template saved', body: () => ({ birthdayPostTitle: title.trim(), birthdayPostBody: body.trim() }) });
  const sample = { name: me?.employee?.fullName ?? 'Ayesha Khan', department: me?.employee?.departmentName ?? 'Sales', designation: me?.employee?.designation ?? 'Manager', company: me?.tenant.name };
  const insert = (ph: string) => (focus === 'title' ? setTitle((t) => `${t}${t.endsWith(' ') || !t ? '' : ' '}${ph}`) : setBody((b) => `${b}${b.endsWith(' ') || !b ? '' : ' '}${ph}`));
  const valid = title.trim().length >= 3 && body.trim().length >= 3;
  return (
    <Card>
      <CardHeader title="Birthday posts" description="Posted to the community feed automatically on each employee's birthday. Use placeholders to personalise it." />
      <CardBody className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Field label="Title" required>{(a) => <Input {...a} maxLength={150} value={title} onFocus={() => setFocus('title')} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="Message" required>{(a) => <Textarea {...a} rows={4} maxLength={1000} value={body} onFocus={() => setFocus('body')} onChange={(e) => setBody(e.target.value)} />}</Field>
          <div>
            <p className="mb-2 text-xs text-muted-foreground">Click to insert into the {focus === 'title' ? 'title' : 'message'}:</p>
            <div className="flex flex-wrap gap-1.5">
              {BIRTHDAY_PLACEHOLDERS.map((ph) => (
                <button key={ph} type="button" onClick={() => insert(ph)} className="rounded-full border bg-muted/40 px-2.5 py-1 font-mono text-xs hover:border-primary hover:text-primary">{ph}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button loading={save.isPending} disabled={!valid} onClick={() => save.mutate(undefined)}>Save template</Button>
            <Button variant="outline" onClick={() => { setTitle(DEFAULT_BIRTHDAY_TITLE); setBody(DEFAULT_BIRTHDAY_BODY); }}><RotateCcw className="h-4 w-4" /> Default wording</Button>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</p>
          <div className="rounded-xl border bg-gradient-to-br from-pink-50 to-amber-50 p-5 dark:from-pink-950/30 dark:to-amber-950/20">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Cake className="h-4 w-4 text-pink-500" aria-hidden /> Birthday · posted automatically</div>
            <p className="mt-2 text-lg font-semibold">{renderBirthdayTemplate(title || DEFAULT_BIRTHDAY_TITLE, sample)}</p>
            <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">{renderBirthdayTemplate(body || DEFAULT_BIRTHDAY_BODY, sample)}</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Shown with {sample.name} as an example.</p>
        </div>
      </CardBody>
    </Card>
  );
}

const SWATCHES = ['#1d4ed8', '#0f766e', '#7c3aed', '#be123c', '#c2410c', '#0f172a'];

/** Employee ID card template, with a live preview on the Company Admin's own details. */
function IdCardSettings() {
  const { me } = useAuth();
  const { data } = useApi<S>('/settings');
  const [t, setT] = useState<IdCardTemplate>(DEFAULT_ID_CARD);
  useEffect(() => { if (data) setT(idCardTemplate(data.settings.idCard)); }, [data]);
  const { refresh: refreshMe } = useAuth();
  const save = useAction('patch', '/settings', { invalidate: ['/settings'], success: 'ID card template saved', onSuccess: () => refreshMe(), body: () => ({ idCard: t }) });
  const set = (patch: Partial<IdCardTemplate>) => setT((x) => ({ ...x, ...patch }));
  const sample = {
    fullName: me?.employee?.fullName ?? 'Ayesha Khan',
    employeeCode: me?.employee?.employeeCode ?? 'EMP-0001',
    designation: me?.employee?.designation ?? 'Manager',
    departmentName: me?.employee?.departmentName ?? 'Sales',
    email: me?.user.email ?? 'ayesha@company.com',
    contactNo: '0300 1234567',
    bloodGroup: 'B+',
    emergencyContact: '0321 7654321',
    joiningDate: todayLocal(),
    avatarFileId: me?.employee?.avatarFileId ?? null,
  };
  return (
    <Card>
      <CardHeader title="ID card" description="Every employee gets an ID card from this template, with their photo, name and employee ID. They can view and download it from their profile." />
      <CardBody className="flex flex-wrap items-start gap-8">
        {/* The form keeps a usable width; the preview wraps below it when both don't fit side by side. */}
        <div className="min-w-0 flex-[1_1_24rem] space-y-5">
          <Field label="Colour">{(a) => (
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((c) => <button key={c} type="button" aria-label={`Use ${c}`} onClick={() => set({ accentColor: c })} className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-card ${t.accentColor === c ? 'ring-2 ring-foreground' : ''}`} style={{ background: c }} />)}
              <input {...a} type="color" value={t.accentColor} onChange={(e) => set({ accentColor: e.target.value })} className="h-8 w-12 cursor-pointer rounded border bg-transparent" />
            </div>
          )}</Field>
          <Field label="Layout">{() => (
            <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Layout">
              {(['VERTICAL', 'HORIZONTAL'] as const).map((l) => <button key={l} type="button" aria-pressed={t.layout === l} onClick={() => set({ layout: l })} className={`rounded px-3 py-1 text-sm ${t.layout === l ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>{l === 'VERTICAL' ? 'Portrait' : 'Landscape'}</button>)}
            </div>
          )}</Field>
          <div>
            <p className="mb-2 text-sm font-medium">Details on the card</p>
            <p className="mb-2 text-xs text-muted-foreground">Photo, name, job title, employee ID and company are always shown.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {ID_CARD_FIELDS.map((f) => (
                <Checkbox key={f} label={`${ID_CARD_FIELD_LABELS[f]}${f === 'emergencyContact' ? ' (back)' : ''}`} checked={t.fields.includes(f)} onChange={(e) => set({ fields: e.target.checked ? [...t.fields, f] : t.fields.filter((x) => x !== f) })} />
              ))}
            </div>
          </div>
          <FormGrid>
            <Field label="Signed by" hint="Name printed under the signature line">{(a) => <Input {...a} maxLength={80} value={t.issuerName} placeholder="e.g. Sara Ahmed" onChange={(e) => set({ issuerName: e.target.value })} />}</Field>
            <Field label="Their title">{(a) => <Input {...a} maxLength={80} value={t.issuerTitle} onChange={(e) => set({ issuerTitle: e.target.value })} />}</Field>
            <Field label="Valid for (years)" hint="0 = no expiry date on the card">{(a) => <Input {...a} type="number" min={0} max={10} value={t.validityYears} onChange={(e) => set({ validityYears: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />}</Field>
          </FormGrid>
          <Field label="Back of the card" hint="E.g. return-if-found note, office address or phone">{(a) => <Textarea {...a} rows={3} maxLength={400} value={t.backText} onChange={(e) => set({ backText: e.target.value })} />}</Field>
          <div className="flex flex-wrap gap-2">
            <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>Save template</Button>
            <Button variant="outline" onClick={() => setT(DEFAULT_ID_CARD)}><RotateCcw className="h-4 w-4" /> Default</Button>
          </div>
        </div>
        <div className="max-w-full min-w-0 overflow-x-auto">
          <p className="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Preview</p>
          <IdCard person={sample} template={t} company={{ name: me?.tenant.name ?? 'Company', logoFileId: me?.tenant.logoFileId }} />
        </div>
      </CardBody>
    </Card>
  );
}

function Schedules() {
  const { data, isLoading } = useApi<WS[]>('/work-schedules');
  const [edit, setEdit] = useState<{ open: boolean; ws?: WS }>({ open: false });
  const form = useZodForm(workScheduleSchema);
  useEffect(() => {
    if (edit.open) form.reset(edit.ws ? { ...edit.ws, startTime: edit.ws.startTime.slice(0, 5), endTime: edit.ws.endTime.slice(0, 5) } : { name: '', startTime: '09:00', endTime: '18:00', breakMinutes: 60, workingDays: [1, 2, 3, 4, 5], isDefault: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit]);
  const days = (form.watch('workingDays') as number[] | undefined) ?? [];
  const save = useAction('post', '/work-schedules', { invalidate: ['/work-schedules'], success: 'Schedule saved', onSuccess: () => setEdit({ open: false }) });
  const update = useAction('put', () => `/work-schedules/${edit.ws!.id}`, { invalidate: ['/work-schedules'], success: 'Schedule saved', onSuccess: () => setEdit({ open: false }) });
  const num = { valueAsNumber: true };
  return (
    <Card>
      <CardHeader title="Working timelines" description="Used for lateness, overtime, leave day counts and payroll hours." action={<Button size="sm" onClick={() => setEdit({ open: true })}><Plus className="h-3.5 w-3.5" /> Add schedule</Button>} />
      <DataTable loading={isLoading} rows={data} rowKey={(w) => w.id} onRowClick={(w) => setEdit({ open: true, ws: w })} columns={[
        { key: 'n', header: 'Name', cell: (w) => <span className="font-medium">{w.name} {w.isDefault && <Badge tone="primary">default</Badge>}</span> },
        { key: 't', header: 'Hours', cell: (w) => `${w.startTime.slice(0, 5)} – ${w.endTime.slice(0, 5)}` },
        { key: 'b', header: 'Break', cell: (w) => `${w.breakMinutes} min` },
        { key: 'd', header: 'Days', hideOnMobile: true, cell: (w) => w.workingDays.map((d) => DAYS[d]).join(', ') },
      ]} />
      <Dialog open={edit.open} onOpenChange={(o) => setEdit({ open: o, ws: edit.ws })} title={edit.ws ? 'Edit schedule' : 'New schedule'}
        footer={<>{edit.ws && !edit.ws.isDefault && <span className="mr-auto"><DeleteButton path={`/work-schedules/${edit.ws.id}`} what={`the "${edit.ws.name}" schedule`} invalidate={['/work-schedules']} onDeleted={() => setEdit({ open: false })} /></span>}<Button variant="outline" onClick={() => setEdit({ open: false })}>Cancel</Button><Button loading={save.isPending || update.isPending} onClick={form.handleSubmit((v) => (edit.ws ? update.mutate(v) : save.mutate(v)))}>Save</Button></>}>
        <div className="space-y-4">
          <Field label="Name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} {...form.register('name')} />}</Field>
          <FormGrid>
            <Field label="Start" error={fieldError(form, 'startTime')}>{(a) => <Input {...a} type="time" {...form.register('startTime')} />}</Field>
            <Field label="End" error={fieldError(form, 'endTime')}>{(a) => <Input {...a} type="time" {...form.register('endTime')} />}</Field>
            <Field label="Break (minutes)" error={fieldError(form, 'breakMinutes')}>{(a) => <Input {...a} type="number" {...form.register('breakMinutes', num)} />}</Field>
          </FormGrid>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Working days</legend>
            <div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <Checkbox key={d} label={d} checked={days.includes(i)} onChange={() => form.setValue('workingDays', (days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort()) as never)} />)}</div>
          </fieldset>
          <Checkbox label="Default for everyone without a specific schedule" {...form.register('isDefault')} />
        </div>
      </Dialog>
    </Card>
  );
}

export default function SettingsPage() {
  const { can, hasModule } = useAuth();
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs tabs={[
        { value: 'company', label: 'Company', hidden: !can(P.TENANT_SETTINGS, P.DIRECTORY_SETTINGS), content: <div className="space-y-6">{can(P.TENANT_SETTINGS) && <CompanyLogoCard />}<Company /></div> },
        { value: 'schedules', label: 'Working hours', hidden: !can(P.ATTENDANCE_MANAGE), content: <Schedules /> },
        { value: 'id-card', label: 'ID card', hidden: !can(P.TENANT_SETTINGS), content: <IdCardSettings /> },
        { value: 'community', label: 'Community', hidden: !can(P.TENANT_SETTINGS) || !hasModule('COMMUNITY'), content: <BirthdayTemplate /> },
      ]} />
    </>
  );
}
