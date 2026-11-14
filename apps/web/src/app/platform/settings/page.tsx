'use client';

import { MODULE_INFO, planSchema, platformSettingsSchema, testEmailSchema, type Module } from '@hrms/shared';
import { CheckCircle2, Mail, Pencil, Plus, Save, Send, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { FileUpload } from '@/components/ui/file-upload';
import { BrandMark } from '@/components/brand';
import { useBranding } from '@/lib/branding';
import { Badge, Card, CardBody, CardHeader, KeyValue, PageHeader, Skeleton } from '@/components/ui/display';
import { Checkbox, Field, FormGrid, Input, Textarea } from '@/components/ui/form';
import { Dialog, Tabs, useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { fieldError, useZodForm } from '@/lib/form';
import { dateTime, money } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { currencyOptions } from '@/lib/locale-options';
import { ModulePicker, NewOwnerDialog, PlatformNav, usePlatformMe, type Plan } from '../shared';
import { InvoiceTemplateSettings, PaymentMethods } from '../billing';
import { defaultCopyright } from '@/lib/branding';
import { SITE } from '@/lib/site';

function PlanDialog({ plan, open, onOpenChange }: { plan?: Plan; open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useZodForm(planSchema);
  const { data: settings } = useApi<PlatformSettings>(open ? '/platform/settings' : null);
  useEffect(() => {
    if (open) form.reset(plan ? { name: plan.name, description: plan.description ?? undefined, priceMonthly: plan.priceMonthly, priceAnnual: plan.priceAnnual, currency: plan.currency, modules: plan.modules, maxEmployees: plan.maxEmployees, isActive: plan.isActive } : { name: '', description: undefined, priceMonthly: 0, priceAnnual: null, currency: settings?.defaultCurrency ?? 'PKR', modules: ['ATTENDANCE', 'LEAVE'], maxEmployees: null, isActive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, settings?.defaultCurrency]);
  const done = { invalidate: ['/platform/plans', '/public/plans'], success: 'Plan saved', onSuccess: () => onOpenChange(false) };
  const create = useAction('post', '/platform/plans', done);
  const update = useAction('put', () => `/platform/plans/${plan!.id}`, done);
  const modules = (form.watch('modules') ?? []) as Module[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={plan ? `Edit ${plan.name}` : 'New plan'}
      description="Companies get the modules you tick. Editing a plan doesn't change companies already on it; open a company and choose the plan again to update it."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={create.isPending || update.isPending} onClick={form.handleSubmit((v) => (plan ? update.mutate(v) : create.mutate(v)))}>Save plan</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} {...form.register('name')} />}</Field>
          <Field label={`Monthly price (${settings?.defaultCurrency ?? 'PKR'})`} hint="Currency is set for the whole platform in General." required error={fieldError(form, 'priceMonthly')}>{(a) => <Input {...a} type="number" min={0} {...form.register('priceMonthly', { valueAsNumber: true })} />}</Field>
          <Field label={`Yearly price (${settings?.defaultCurrency ?? 'PKR'})`} hint="Paid once a year. Leave empty for 12 × monthly." error={fieldError(form, 'priceAnnual')}>{(a) => <Input {...a} type="number" min={0} {...form.register('priceAnnual', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })} />}</Field>
          <Field label="Employee limit" hint="Leave empty for no limit" error={fieldError(form, 'maxEmployees')}>{(a) => <Input {...a} type="number" min={1} {...form.register('maxEmployees', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })} />}</Field>
        </FormGrid>
        <Field label="Description" error={fieldError(form, 'description')}>{(a) => <Textarea {...a} rows={2} {...form.register('description')} />}</Field>
        <div>
          <p className="mb-2 text-sm font-medium">Modules</p>
          <ModulePicker value={modules} onChange={(m) => form.setValue('modules', m, { shouldDirty: true })} />
          {fieldError(form, 'modules') && <p className="mt-1 text-xs text-danger">{fieldError(form, 'modules')}</p>}
        </div>
        <Checkbox label="Active (can be chosen for companies)" {...form.register('isActive')} />
      </div>
    </Dialog>
  );
}

function Plans() {
  const { data, isLoading } = useApi<Plan[]>('/platform/plans');
  const [edit, setEdit] = useState<{ open: boolean; plan?: Plan }>({ open: false });
  const del = useAction<string>('del', (id) => `/platform/plans/${id}`, { invalidate: ['/platform/plans'], success: 'Plan deleted' });
  const { confirm, node } = useConfirm();
  return (
    <Card>
      <CardHeader title="Plans" description="What you sell. Each company is on one plan, or a custom set of modules." action={<Button size="sm" onClick={() => setEdit({ open: true })}><Plus className="h-4 w-4" /> New plan</Button>} />
      <DataTable loading={isLoading} rows={data} rowKey={(p) => p.id} onRowClick={(p) => setEdit({ open: true, plan: p })} empty="No plans yet" columns={[
        { key: 'n', header: 'Plan', cell: (p) => <div><p className="font-medium">{p.name} {!p.isActive && <Badge>inactive</Badge>}</p>{p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}</div> },
        { key: 'p', header: 'Price', cell: (p) => <div className="tabular-nums"><p>{money(p.priceMonthly, p.currency)}<span className="text-muted-foreground">/mo</span></p><p className="text-xs text-muted-foreground">{money(p.priceAnnual ?? p.priceMonthly * 12, p.currency)}/yr</p></div> },
        { key: 'm', header: 'Modules', cell: (p) => <div className="flex flex-wrap gap-1">{p.modules.map((m) => <Badge key={m} tone="primary">{MODULE_INFO[m].label}</Badge>)}</div> },
        { key: 'e', header: 'Employees', hideOnMobile: true, cell: (p) => p.maxEmployees ?? 'Unlimited' },
        { key: 'c', header: 'Companies', cell: (p) => p.companies },
        { key: 'a', header: <span className="sr-only">Actions</span>, cell: (p) => (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon" variant="ghost" aria-label={`Edit ${p.name}`} onClick={() => setEdit({ open: true, plan: p })}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Delete ${p.name}`} className="text-danger" onClick={async () => { if (await confirm({ title: `Delete the ${p.name} plan?`, body: p.companies ? `${p.companies} compan${p.companies === 1 ? 'y is' : 'ies are'} on this plan, so it can't be deleted. Deactivate it instead.` : 'This cannot be undone.', danger: true, confirmLabel: 'Delete' })) del.mutate(p.id); }}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ) },
      ]} />
      <PlanDialog plan={edit.plan} open={edit.open} onOpenChange={(o) => setEdit({ open: o, plan: edit.plan })} />
      {node}
    </Card>
  );
}

function Owners() {
  const { data } = useApi<{ id: string; name: string; email: string; lastLoginAt: string | null }[]>('/platform/admins');
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader title="Super Admins" description="People who run the whole platform: companies, plans and settings. Only an existing Super Admin can add another." action={<Button size="sm" variant="outline" onClick={() => setOpen(true)}><ShieldCheck className="h-4 w-4" /> Add Super Admin</Button>} />
      <DataTable rows={data} rowKey={(o) => o.id} columns={[
        { key: 'n', header: 'Name', cell: (o) => <div><p className="font-medium">{o.name}</p><p className="text-xs text-muted-foreground">{o.email}</p></div> },
        { key: 'l', header: 'Last sign-in', cell: (o) => (o.lastLoginAt ? dateTime(o.lastLoginAt) : 'never') },
      ]} />
      <NewOwnerDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}

function Email({ myEmail }: { myEmail: string }) {
  const { data } = useApi<{ configured: boolean; host: string | null; from: string }>('/platform/email');
  const form = useZodForm(testEmailSchema, { to: myEmail });
  const [result, setResult] = useState<{ delivered: boolean; info: string } | null>(null);
  const test = useAction<{ to: string }, { delivered: boolean; info: string }>('post', '/platform/email/test', { onSuccess: setResult });
  return (
    <Card>
      <CardHeader title="Outgoing email" description="Welcome emails, invitations, password resets and notifications. Set SMTP_URL and MAIL_FROM on the server to change it." />
      <CardBody className="space-y-5">
        {data && (
          <KeyValue items={[
            ['Status', data.configured ? <span key="s" className="flex items-center gap-1.5 text-success"><CheckCircle2 className="h-4 w-4" /> SMTP configured</span> : <span key="s" className="flex items-center gap-1.5 text-warning"><XCircle className="h-4 w-4" /> Not configured – emails are only written to the API log</span>],
            ['Mail server', data.host ?? '—'],
            ['Sender', data.from],
          ]} />
        )}
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <Field label="Send a test email to" className="min-w-64 flex-1" error={fieldError(form, 'to')}>{(a) => <Input {...a} type="email" {...form.register('to')} />}</Field>
          <Button loading={test.isPending} onClick={form.handleSubmit((v) => { setResult(null); test.mutate(v); })}><Send className="h-4 w-4" /> Send test</Button>
        </div>
        {result && (
          <p className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${result.delivered ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
            <Mail className="mt-0.5 h-4 w-4 shrink-0" /> {result.info}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

interface PlatformSettings { defaultCurrency: string; siteName: string | null; copyright: string | null }

function General() {
  const { data } = useApi<PlatformSettings>('/platform/settings');
  const form = useZodForm(platformSettingsSchema, { defaultCurrency: 'PKR', siteName: undefined, copyright: undefined });
  useEffect(() => {
    if (data) form.reset({ defaultCurrency: data.defaultCurrency, siteName: data.siteName ?? undefined, copyright: data.copyright ?? undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  const save = useAction('put', '/platform/settings', { invalidate: ['/platform/settings', '/platform/plans', '/public/branding', '/public/plans'], success: 'Settings saved. Every plan now uses this currency.' });
  const copyright = form.watch('copyright');
  const siteName = form.watch('siteName');
  const preview = copyright ? copyright.replaceAll('{year}', String(new Date().getFullYear())) : defaultCopyright(siteName || SITE.name);
  if (!data) return <Skeleton className="h-64" />;
  return (
    <Card>
      <CardHeader title="General" description="Defaults and branding shared by every company." />
      <CardBody className="space-y-5">
        <FormGrid>
          <Field label="Platform currency" hint="All plans and the homepage show prices in this currency. Changing it updates every plan at once (the numbers stay the same)." error={fieldError(form, 'defaultCurrency')}>{(a) => (
            <Combobox {...a} value={form.watch('defaultCurrency')} onChange={(c) => form.setValue('defaultCurrency', c, { shouldDirty: true, shouldValidate: true })} options={currencyOptions()} renderValue={(o) => o.value} searchPlaceholder="Search currency…" />
          )}</Field>
        </FormGrid>
        <Field label="Platform name" hint={`Shown in the logo, browser tab titles, footer and everywhere the product is named. Empty = "${SITE.name}".`} error={fieldError(form, 'siteName')}>{(a) => (
          <Input {...a} maxLength={40} placeholder={SITE.name} {...form.register('siteName')} />
        )}</Field>
        <Field label="Sign-in page footer" hint="Shown at the bottom of the login pages. Write {year} for the current year. Leave empty for the default." error={fieldError(form, 'copyright')}>{(a) => (
          <Input {...a} maxLength={200} placeholder="© {year} Your Company. All rights reserved." {...form.register('copyright')} />
        )}</Field>
        <p className="text-xs text-muted-foreground">Preview: <span className="font-medium text-foreground">{preview}</span></p>
        <div className="flex justify-end border-t pt-4">
          <Button loading={save.isPending} onClick={form.handleSubmit((v) => save.mutate(v))}><Save className="h-4 w-4" /> Save</Button>
        </div>
      </CardBody>
    </Card>
  );
}

const readDataUrl = (f: File) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(f);
});

/** Upload / remove the platform logo or favicon. */
function BrandImage({ kind, current }: { kind: 'logo' | 'favicon'; current: string | null }) {
  const [files, setFiles] = useState<File[]>([]);
  const save = useAction<{ data: string | null }>('put', `/platform/settings/${kind}`, {
    invalidate: ['/public/branding', '/platform/settings'],
    success: kind === 'logo' ? 'Logo updated' : 'Favicon updated',
    onSuccess: () => setFiles([]),
  });
  const label = kind === 'logo' ? 'Platform logo' : 'Favicon';
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{kind === 'logo' ? 'Shown on the homepage, sign-in pages and app header. PNG, JPG or WebP, wide format, up to 256 KB.' : 'The small icon in the browser tab. Square PNG or ICO (e.g. 64×64), up to 256 KB.'}</p>
        </div>
        <div className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-md border bg-muted/40 px-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {current ? <img src={current} alt={`Current ${label.toLowerCase()}`} className={kind === 'logo' ? 'h-8 max-w-36 object-contain' : 'h-8 w-8 object-contain'} /> : <BrandMark className="h-8 w-8" title="Default" />}
        </div>
      </div>
      <FileUpload value={files} onChange={setFiles} accept={kind === 'logo' ? '.png,.jpg,.jpeg,.webp' : '.png,.ico,.jpg,.jpeg,.webp'} maxSizeMB={0.25} label={`Choose a ${kind === 'logo' ? 'logo' : 'favicon'}`} />
      <div className="flex justify-end gap-2">
        {current && <Button variant="outline" size="sm" loading={save.isPending && !files.length} onClick={() => save.mutate({ data: null })}>Use default</Button>}
        <Button size="sm" disabled={!files.length} loading={save.isPending && !!files.length} onClick={async () => save.mutate({ data: await readDataUrl(files[0]!) })}>Upload</Button>
      </div>
    </div>
  );
}

function Branding() {
  const { logoUrl, faviconUrl } = useBranding();
  return (
    <Card>
      <CardHeader title="Branding" description="Your logo and browser icon, used on every page of the platform and in every company's workspace." />
      <CardBody className="grid gap-4 md:grid-cols-2">
        <BrandImage kind="logo" current={logoUrl} />
        <BrandImage kind="favicon" current={faviconUrl} />
      </CardBody>
    </Card>
  );
}

/** General settings for all companies. */
export default function PlatformSettingsPage() {
  const { data: me, isLoading } = usePlatformMe();
  if (isLoading || !me) return <Skeleton className="h-96" />;
  return (
    <>
      <PlatformNav me={me} />
      <PageHeader title="Platform settings" description="Settings that apply to every company." />
      <Tabs tabs={[
        { value: 'plans', label: 'Plans & pricing', content: <Plans /> },
        { value: 'general', label: 'General', content: <div className="space-y-6"><General /><Branding /></div> },
        { value: 'payments', label: 'Payment methods', content: <PaymentMethods /> },
        { value: 'invoices', label: 'Invoices', content: <InvoiceTemplateSettings /> },
        { value: 'owners', label: 'Super Admins', content: <Owners /> },
        { value: 'email', label: 'Email', content: <Email myEmail={me.email} /> },
      ]} />
    </>
  );
}
