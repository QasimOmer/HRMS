'use client';

import { MODULE_INFO, MODULES, createCompanySchema, platformAdminSchema, suggestEmailDomain, type Module } from '@hrms/shared';
import { Building2, Copy, LogOut, RefreshCw, Settings, Users } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import { Checkbox, CompanyEmailInput, Field, FormGrid, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { cn, money } from '@/lib/format';
import { fieldError, useZodForm } from '@/lib/form';
import { useAction, useApi } from '@/lib/hooks';
import { currencyOptions, timeZoneOptions } from '@/lib/locale-options';

export interface PlatformMe { id: string; name: string; email: string }
export interface Plan { id: string; name: string; description: string | null; priceMonthly: number; priceAnnual: number | null; currency: string; modules: Module[]; maxEmployees: number | null; isActive: boolean; companies: number }
export interface CompanyRow { id: string; name: string; slug: string; status: 'ACTIVE' | 'SUSPENDED'; timezone: string; currency: string; activeEmployees: number; maxEmployees: number | null; modules: Module[]; planId: string | null; planName: string | null; createdAt: string; billingCycle: 'MONTHLY' | 'ANNUAL'; billingStatus: 'PAID' | 'DUE' | 'UNPAID'; paidUntil: string | null; signupSource: 'PLATFORM' | 'SELF'; isDemo: boolean }

/** Signed-in platform owner; sends anyone else to the platform login. */
export function usePlatformMe() {
  const router = useRouter();
  const q = useApi<PlatformMe>('/platform/me');
  useEffect(() => {
    if (q.error) router.replace('/platform/login');
  }, [q.error, router]);
  return q;
}

/** Top navigation of the platform console. */
export function PlatformNav({ me }: { me: PlatformMe }) {
  const pathname = usePathname();
  const router = useRouter();
  const links = [
    { href: '/platform', label: 'Companies', icon: Building2, on: pathname === '/platform' || pathname.startsWith('/platform/companies') },
    { href: '/platform/leads', label: 'Leads', icon: Users, on: pathname.startsWith('/platform/leads') },
    { href: '/platform/settings', label: 'Platform settings', icon: Settings, on: pathname.startsWith('/platform/settings') },
  ];
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Platform" className="flex flex-wrap gap-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.on ? 'page' : undefined}
            className={cn('flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm', l.on ? 'border-primary bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground')}>
            <l.icon className="h-4 w-4" aria-hidden /> {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="hidden sm:inline">{me.name}</span>
        <Button variant="outline" size="sm" onClick={async () => { await api.post('/platform/logout'); router.replace('/platform/login'); }}><LogOut className="h-4 w-4" /> Sign out</Button>
      </div>
    </div>
  );
}

/** Module on/off list used for plans and per-company deals. */
export function ModulePicker({ value, onChange }: { value: Module[]; onChange: (m: Module[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {MODULES.map((m) => (
        <label key={m} className={cn('flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors', value.includes(m) ? 'border-primary bg-primary-soft/60' : 'hover:bg-muted/50')}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--primary)]" checked={value.includes(m)} onChange={() => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m])} />
          <span>
            <span className="block text-sm font-medium">{MODULE_INFO[m].label}</span>
            <span className="block text-xs text-muted-foreground">{MODULE_INFO[m].description}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

export const planLabel = (p: Plan) => `${p.name} – ${money(p.priceMonthly, p.currency)}/month`;

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/** Strong, easy-to-read password (no 0/O, 1/l/I) with upper, lower and digits. */
export function generatePassword(length = 16): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const all = upper + lower + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!;
  const chars = [pick(upper), pick(lower), pick(digits), ...Array.from({ length: length - 3 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** Shown once after a company is created with generated sign-in details. */
export function CredentialsDialog({ creds, onClose }: { creds: { company: string; workspace: string; email: string; password: string } | null; onClose: () => void }) {
  if (!creds) return null;
  const url = typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login';
  const text = `${creds.company}\nSign in: ${url}\nEmail: ${creds.email}\nTemporary password: ${creds.password}\n(You'll be asked to choose your own password.)`;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Company Admin sign-in details" description="Copy them now and share them securely. The password is not stored in readable form and is never emailed."
      footer={<><Button variant="outline" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success('Copied'))}><Copy className="h-4 w-4" /> Copy all</Button><Button onClick={onClose}>Done</Button></>}>
      <dl className="space-y-3 text-sm">
        {[['Company', creds.company], ['Sign-in page', url], ['Email', creds.email], ['Temporary password', creds.password]].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
            <div className="min-w-0"><dt className="text-xs text-muted-foreground">{k}</dt><dd className={cn('truncate font-medium', k === 'Temporary password' && 'font-mono')}>{v}</dd></div>
            <Button size="icon" variant="ghost" aria-label={`Copy ${k}`} onClick={() => navigator.clipboard.writeText(v!).then(() => toast.success(`${k} copied`))}><Copy className="h-4 w-4" /></Button>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function NewCompanyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { data: plans } = useApi<Plan[]>(open ? '/platform/plans' : null);
  // Default: generate sign-in details now; alternative: email a link so they choose their own password.
  const [setPassword, setSetPassword] = useState(true);
  const [creds, setCreds] = useState<{ company: string; workspace: string; email: string; password: string; tenantId: string } | null>(null);
  const blank = { companyName: '', workspace: '', adminName: '', email: '', password: undefined, mustChangePassword: true, planId: undefined, timezone: 'Asia/Karachi', currency: 'PKR' };
  const form = useZodForm(createCompanySchema, blank);
  useEffect(() => {
    if (open) {
      form.reset({ ...blank, password: generatePassword() } as never);
      setSetPassword(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = useAction<unknown, { tenantId: string; invited: boolean }>('post', '/platform/companies', {
    invalidate: ['/platform/companies', '/platform/plans'],
    onSuccess: (r) => {
      onOpenChange(false);
      if (r.invited) {
        toast.success('Company created. A welcome email with a link to set a password was sent to the Company Admin.');
        router.push(`/platform/companies/${r.tenantId}`);
      } else {
        const v = form.getValues();
        setCreds({ company: v.companyName, workspace: v.workspace, email: v.email, password: v.password as string, tenantId: r.tenantId });
      }
    },
  });
  return (
    <>
    <CredentialsDialog creds={creds} onClose={() => { const id = creds?.tenantId; setCreds(null); if (id) router.push(`/platform/companies/${id}`); }} />
    <Dialog open={open} onOpenChange={onOpenChange} title="New company" description="Creates the workspace with default departments, levels and leave types, and emails its first Company Admin." size="lg"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={create.isPending} onClick={form.handleSubmit((v) => create.mutate(setPassword ? v : { ...v, password: undefined }))}>Create company</Button></>}>
      <div className="space-y-4">
        <FormGrid>
          <Field label="Company name" required error={fieldError(form, 'companyName')}>{(a) => <Input {...a} {...form.register('companyName', { onChange: (e) => { if (!form.getFieldState('workspace').isDirty) form.setValue('workspace', slugify(e.target.value)); if (!form.getFieldState('emailDomain').isDirty) form.setValue('emailDomain', suggestEmailDomain(e.target.value)); } })} />}</Field>
          <Field label="Workspace" required error={fieldError(form, 'workspace')} hint="Used to sign in, e.g. acme">{(a) => <Input {...a} autoCapitalize="none" {...form.register('workspace')} />}</Field>
          <Field label="Company Admin name" required error={fieldError(form, 'adminName')}>{(a) => <Input {...a} {...form.register('adminName')} />}</Field>
          <Field label="Email domain" required error={fieldError(form, 'emailDomain')} hint="Everyone's login email ends with this">{(a) => <Input {...a} autoCapitalize="none" placeholder="company.com" {...form.register('emailDomain', { setValueAs: (x) => (x === '' ? undefined : String(x).replace(/^@/, '').toLowerCase()) })} />}</Field>
          <Field label="Company Admin email" required error={fieldError(form, 'email')} hint="Login email; the welcome email also goes here">{(a) => <CompanyEmailInput {...a} domain={form.watch('emailDomain')} value={form.watch('email')} onChange={(v) => form.setValue('email', v, { shouldValidate: form.formState.isSubmitted })} placeholder="admin" />}</Field>
          <Field label="Plan" error={fieldError(form, 'planId')} hint="Decides which modules the company gets">{(a) => (
            <Select {...a} {...form.register('planId', { setValueAs: (v) => (v === '' ? undefined : v) })}>
              <option value="">All modules (no plan)</option>
              {plans?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{planLabel(p)}</option>)}
            </Select>
          )}</Field>
          <Field label="Time zone" error={fieldError(form, 'timezone')}>{(a) => <Combobox {...a} value={form.watch('timezone')} onChange={(tz) => form.setValue('timezone', tz, { shouldDirty: true })} options={timeZoneOptions()} searchPlaceholder="Search city, region or UTC offset…" />}</Field>
          <Field label="Currency" error={fieldError(form, 'currency')}>{(a) => <Combobox {...a} value={form.watch('currency')} onChange={(c) => form.setValue('currency', c, { shouldDirty: true })} options={currencyOptions()} renderValue={(o) => o.value} searchPlaceholder="Search currency…" />}</Field>
        </FormGrid>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Company Admin sign-in</legend>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="admin-access" className="mt-1 accent-[var(--primary)]" checked={setPassword} onChange={() => { setSetPassword(true); if (!form.getValues('password')) form.setValue('password', generatePassword()); }} />
            <span><span className="font-medium">Generate sign-in details now</span><span className="block text-xs text-muted-foreground">You see the email and a temporary password to share. They choose their own password at first sign-in.</span></span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input type="radio" name="admin-access" className="mt-1 accent-[var(--primary)]" checked={!setPassword} onChange={() => setSetPassword(false)} />
            <span><span className="font-medium">Email a link to set their own password</span><span className="block text-xs text-muted-foreground">Nobody else ever sees their password.</span></span>
          </label>
        </fieldset>
        {setPassword && (
          <Field label="Temporary password" required error={fieldError(form, 'password')} hint="Generated for you; you can edit it. A welcome email is still sent, without the password.">{(a) => (
            <div className="flex gap-2">
              <Input {...a} className="font-mono" autoComplete="off" {...form.register('password')} />
              <Button type="button" variant="outline" onClick={() => form.setValue('password', generatePassword(), { shouldValidate: true })}><RefreshCw className="h-4 w-4" /> New</Button>
            </div>
          )}</Field>
        )}
      </div>
    </Dialog>
    </>
  );
}

export function NewOwnerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useZodForm(platformAdminSchema, { name: '', email: '', password: '' });
  const add = useAction('post', '/platform/admins', { invalidate: ['/platform/admins'], success: 'Super Admin added', onSuccess: () => { form.reset(); onOpenChange(false); } });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add Super Admin" description="Super Admins manage every company, plan and platform setting."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={add.isPending} onClick={form.handleSubmit((v) => add.mutate(v))}>Add owner</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={fieldError(form, 'name')}>{(a) => <Input {...a} {...form.register('name')} />}</Field>
        <Field label="Email" required error={fieldError(form, 'email')}>{(a) => <Input {...a} type="email" {...form.register('email')} />}</Field>
        <Field label="Password" required error={fieldError(form, 'password')} hint="12+ characters with upper and lower case letters and a number">{(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('password')} />}</Field>
      </div>
    </Dialog>
  );
}
