'use client';

import { MODULE_INFO, type Module } from '@hrms/shared';
import { ArrowLeft, Building2, Mail, Save, ShieldOff, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { use, useEffect, useState } from 'react';
import { CompanyLogo } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui/display';
import { Field, FormGrid, Input, Select } from '@/components/ui/form';
import { useConfirm } from '@/components/ui/overlay';
import { DataTable } from '@/components/ui/table';
import { date, dateTime } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { ModulePicker, PlatformNav, planLabel, usePlatformMe, type Plan } from '../../shared';
import { CompanyBilling } from '../../billing';

interface Detail {
  id: string; name: string; slug: string; status: 'ACTIVE' | 'SUSPENDED'; timezone: string; currency: string;
  planId: string | null; modules: Module[]; maxEmployees: number | null; emailDomain: string | null; createdAt: string;
  activeEmployees: number; totalEmployees: number;
  superAdmins: { id: string; email: string; status: string; lastLoginAt: string | null; name: string | null }[];
  billingCycle: 'MONTHLY' | 'ANNUAL'; billingStatus: 'PAID' | 'DUE' | 'UNPAID'; paidUntil: string | null; signupSource: 'PLATFORM' | 'SELF'; isDemo: boolean;
}

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: me } = usePlatformMe();
  const key = `/platform/companies/${id}`;
  const { data: c, isLoading, error } = useApi<Detail>(me ? key : null);
  const { data: plans } = useApi<Plan[]>(me ? '/platform/plans' : null);
  const { confirm, node } = useConfirm();

  const [planId, setPlanId] = useState<string>('');
  const [modules, setModules] = useState<Module[]>([]);
  const [max, setMax] = useState<string>('');
  const [domain, setDomain] = useState<string>('');
  useEffect(() => {
    if (!c) return;
    setPlanId(c.planId ?? '');
    setModules(c.modules);
    setMax(c.maxEmployees ? String(c.maxEmployees) : '');
    setDomain(c.emailDomain ?? '');
  }, [c]);

  const inv = ['/platform/companies', '/platform/plans'];
  const save = useAction('patch', key, { invalidate: inv, success: 'Subscription saved. Changes apply to the company right away.', body: () => ({ planId: planId || null, modules, maxEmployees: max ? Number(max) : null, ...(domain && domain !== c?.emailDomain ? { emailDomain: domain } : {}) }) });
  const status = useAction<'ACTIVE' | 'SUSPENDED'>('patch', key, { invalidate: inv, success: (r) => ((r as { status: string }).status === 'SUSPENDED' ? 'Company suspended: nobody can sign in' : 'Company reactivated'), body: (s) => ({ status: s }) });
  const welcome = useAction<unknown, { sent: string[] }>('post', `${key}/welcome`, { success: (r) => `Welcome email sent to ${(r as { sent: string[] }).sent.join(', ')}`, body: () => ({}) });

  if (error?.status === 404) return <CompanyGone />;
  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !c || !me) return <Skeleton className="h-96" />;

  // Choosing a plan fills in its modules and limit; they can still be adjusted for this company.
  const pickPlan = (pid: string) => {
    setPlanId(pid);
    const p = plans?.find((x) => x.id === pid);
    if (p) {
      setModules(p.modules);
      setMax(p.maxEmployees ? String(p.maxEmployees) : '');
    }
  };
  const plan = plans?.find((p) => p.id === planId);
  const custom = plan && (plan.modules.length !== modules.length || plan.modules.some((m) => !modules.includes(m)) || (plan.maxEmployees ?? '') !== (max ? Number(max) : ''));
  const dirty = (c.planId ?? '') !== planId || c.modules.length !== modules.length || c.modules.some((m) => !modules.includes(m)) || String(c.maxEmployees ?? '') !== max || (c.emailDomain ?? '') !== domain;

  return (
    <>
      <PlatformNav me={me} />
      <Link href="/platform" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> All companies</Link>
      <PageHeader
        title={c.name}
        description={`Workspace ${c.slug} · ${c.timezone} · ${c.currency} · created ${date(c.createdAt)}`}
        actions={<>
          <Badge tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>{c.status.toLowerCase()}</Badge>
          {c.status === 'ACTIVE'
            ? <Button variant="outline" className="text-danger" onClick={async () => { if (await confirm({ title: `Suspend ${c.name}?`, body: 'Everyone in this company is signed out at once and cannot sign in until you reactivate it. No data is deleted.', danger: true, confirmLabel: 'Suspend' })) status.mutate('SUSPENDED'); }}><ShieldOff className="h-4 w-4" /> Suspend</Button>
            : <Button variant="success" onClick={() => status.mutate('ACTIVE')}><ShieldCheck className="h-4 w-4" /> Reactivate</Button>}
        </>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Active employees" value={`${c.activeEmployees}${c.maxEmployees ? ` / ${c.maxEmployees}` : ''}`} hint={c.maxEmployees ? `${Math.max(0, c.maxEmployees - c.activeEmployees)} seats left` : 'No limit'} />
        <Stat label="Plan" tone="info" value={plans?.find((p) => p.id === c.planId)?.name ?? 'Custom'} />
        <Stat label="Modules" tone="success" value={c.modules.length} hint={c.modules.map((m) => MODULE_INFO[m].label).join(', ') || 'Core only'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Subscription" description="What this company can use. Core features (employees, access & roles, settings, calendar) are always included." />
          <CardBody className="space-y-5">
            <FormGrid>
              <Field label="Plan">{(a) => (
                <Select {...a} value={planId} onChange={(e) => pickPlan(e.target.value)}>
                  <option value="">Custom (no plan)</option>
                  {plans?.map((p) => <option key={p.id} value={p.id}>{planLabel(p)}{p.isActive ? '' : ' (inactive)'}</option>)}
                </Select>
              )}</Field>
              <Field label="Employee limit" hint="Active employees. Leave empty for no limit.">{(a) => <Input {...a} type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
              <Field label="Email domain" hint="New login emails end with @this. Existing accounts keep their emails.">{(a) => <Input {...a} value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase().replace(/^@/, ''))} placeholder="company.com" />}</Field>
            </FormGrid>
            {custom && <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">Modules or limit differ from the {plan!.name} plan: this company has a custom deal.</p>}
            <ModulePicker value={modules} onChange={setModules} />
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate(undefined)}><Save className="h-4 w-4" /> Save subscription</Button>
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Company Admins" description="They manage the company and decide what each role can do, within this subscription." />
          <DataTable rows={c.superAdmins} rowKey={(a) => a.id} empty="No Company Admin" columns={[
            { key: 'n', header: 'Name', cell: (a) => <div className="flex items-center gap-2"><CompanyLogo name={a.name ?? a.email} className="h-8 w-8 text-xs" /><div className="min-w-0"><p className="truncate font-medium">{a.name ?? a.email}</p><p className="truncate text-xs text-muted-foreground">{a.email}</p></div></div> },
            { key: 's', header: 'Status', cell: (a) => <Badge tone={a.status === 'ACTIVE' ? 'success' : a.status === 'INVITED' ? 'warning' : 'danger'}>{a.status === 'INVITED' ? 'invite pending' : a.status.toLowerCase()}</Badge> },
            { key: 'l', header: 'Last sign-in', hideOnMobile: true, cell: (a) => (a.lastLoginAt ? dateTime(a.lastLoginAt) : 'never') },
          ]} />
          <CardBody className="border-t">
            <Button variant="outline" size="sm" loading={welcome.isPending} onClick={() => welcome.mutate(undefined)}><Mail className="h-4 w-4" /> Resend welcome email</Button>
            <p className="mt-2 text-xs text-muted-foreground">Admins who haven&apos;t set a password get a fresh set-password link.</p>
          </CardBody>
        </Card>
      </div>
      <CompanyBilling companyId={c.id} cycle={c.billingCycle} status={c.billingStatus} paidUntil={c.paidUntil} isDemo={c.isDemo} />
      {node}
    </>
  );
}

/** The company was removed (or the link is wrong): explain it and refresh the list so it disappears there too. */
function CompanyGone() {
  const qc = useQueryClient();
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['/platform/companies'] }); }, [qc]);
  return (
    <Card>
      <EmptyState icon={Building2} title="This company no longer exists" description="It may have been deleted. The company list has been refreshed."
        action={<Link href="/platform" className="inline-flex h-9 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted"><ArrowLeft className="h-4 w-4" /> Back to companies</Link>} />
    </Card>
  );
}
