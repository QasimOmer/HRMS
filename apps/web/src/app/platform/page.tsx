'use client';

import { Building2, CheckCircle2, CreditCard, Plus, Search, Settings, TrendingUp, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CompanyLogo } from '@/components/brand';
import { QuickActions } from '@/components/overview';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { date, money } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { NewCompanyDialog, PlatformNav, usePlatformMe, type CompanyRow } from './shared';
import { RecentLeads } from './billing';
import { BillingStatusBadge } from '@/components/billing-status';

interface Plan { id: string; name: string; priceMonthly: number; priceAnnual: number | null; currency: string }

/** Platform-wide KPIs, what needs attention, newest companies and shortcuts. */
function PlatformOverview({ companies, onNewCompany }: { companies: CompanyRow[]; onNewCompany: () => void }) {
  const { data: plans } = useApi<Plan[]>('/platform/plans');
  const real = companies.filter((c) => !c.isDemo);
  const monthStart = new Date().toISOString().slice(0, 7);
  // Recurring revenue from paying companies' plans (yearly prices spread over 12 months), per currency.
  const mrr = new Map<string, number>();
  for (const c of real) {
    const p = plans?.find((x) => x.id === c.planId);
    if (!p || c.status !== 'ACTIVE') continue;
    const monthly = c.billingCycle === 'ANNUAL' && p.priceAnnual ? p.priceAnnual / 12 : p.priceMonthly;
    mrr.set(p.currency, (mrr.get(p.currency) ?? 0) + monthly);
  }
  const attention = real.filter((c) => c.billingStatus !== 'PAID' || c.status !== 'ACTIVE' || (c.maxEmployees && c.activeEmployees >= c.maxEmployees));
  const newest = [...real].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const reason = (c: CompanyRow) =>
    c.status !== 'ACTIVE' ? 'Suspended' : c.billingStatus === 'UNPAID' ? 'Unpaid: locked to Billing' : c.billingStatus === 'DUE' ? 'Payment due' : 'At its employee limit';

  return (
    <div className="mb-6 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Companies" icon={Building2} value={real.length} hint={`${real.filter((c) => c.status === 'ACTIVE').length} active · ${real.filter((c) => c.createdAt.slice(0, 7) === monthStart).length} new this month`} />
        <Stat label="Active staff" icon={Users} tone="info" value={real.reduce((a, c) => a + c.activeEmployees, 0)} hint="Across all companies" />
        <Stat label="Payments" icon={CreditCard} tone={real.some((c) => c.billingStatus !== 'PAID') ? 'warning' : 'success'} value={`${real.filter((c) => c.billingStatus === 'PAID').length} paid`} hint={`${real.filter((c) => c.billingStatus === 'DUE').length} due · ${real.filter((c) => c.billingStatus === 'UNPAID').length} unpaid`} />
        <Stat label="Monthly recurring revenue" icon={TrendingUp} tone="success" value={<span className="text-xl">{mrr.size ? [...mrr].map(([cur, v]) => money(Math.round(v), cur)).join(' + ') : '—'}</span>} hint={`${real.filter((c) => c.signupSource === 'SELF').length} signed up from the website`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Needs attention" description="Unpaid, due, suspended or at their employee limit" />
          {attention.length ? (
            <ul className="divide-y">
              {attention.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/platform/companies/${c.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="min-w-0"><span className="block truncate font-medium">{c.name}</span><span className="block text-xs text-muted-foreground">{reason(c)}</span></span>
                    <BillingStatusBadge status={c.billingStatus} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={CheckCircle2} title="All companies are in good standing" />}
        </Card>
        <Card>
          <CardHeader title="Newest companies" />
          {newest.length ? (
            <ul className="divide-y">
              {newest.map((c) => (
                <li key={c.id}>
                  <Link href={`/platform/companies/${c.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/50">
                    <span className="min-w-0 truncate font-medium">{c.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{date(c.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No companies yet" />}
        </Card>
      </div>
      <QuickActions actions={[
        { onClick: onNewCompany, label: 'New company', description: 'Workspace and Company Admin', icon: Plus },
        { href: '/platform/leads', label: 'Leads', description: 'Demo visitors and sign-ups', icon: UserPlus },
        { href: '/platform/settings', label: 'Plans & settings', description: 'Pricing, Super Admins, email', icon: Settings },
      ]} />
    </div>
  );
}

/** Landing page after a platform owner signs in: platform dashboard, then pick a company. */
export default function PlatformPage() {
  const { data: me, isLoading } = usePlatformMe();
  const { data: companies, isLoading: cl } = useApi<CompanyRow[]>(me ? '/platform/companies' : null, { fresh: true });
  const [q, setQ] = useState('');
  const [newCompany, setNewCompany] = useState(false);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (companies ?? []).filter((c) => !t || `${c.name} ${c.slug} ${c.planName ?? ''}`.toLowerCase().includes(t));
  }, [companies, q]);

  if (isLoading || !me) return <Skeleton className="h-96" />;
  return (
    <>
      <PlatformNav me={me} />
      <PageHeader title="Platform dashboard" description="All client companies at a glance. Open a company to manage its plan, modules and Company Admins."
        actions={<Button onClick={() => setNewCompany(true)}><Plus className="h-4 w-4" /> New company</Button>} />

      {cl ? <Skeleton className="mb-6 h-32" /> : <PlatformOverview companies={companies ?? []} onNewCompany={() => setNewCompany(true)} />}

      <RecentLeads />

      <h2 className="mb-3 text-lg font-semibold">Companies</h2>
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-muted-foreground" aria-hidden />
        <Input className="pl-9" placeholder="Search companies…" aria-label="Search companies" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {cl ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : !shown.length ? (
        <Card><EmptyState title={companies?.length ? 'No company matches your search' : 'No companies yet'} description={companies?.length ? undefined : 'Create the first client company.'} /></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((c) => (
            <li key={c.id}>
              <Link href={`/platform/companies/${c.id}`} className="flex h-full flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:border-primary/50">
                <div className="flex items-start gap-3">
                  <CompanyLogo name={c.name} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">workspace: {c.slug}</p>
                  </div>
                  <Badge tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>{c.status.toLowerCase()}</Badge>
                  {!c.isDemo && <BillingStatusBadge status={c.billingStatus} />}
                  {c.isDemo && <Badge tone="info">demo</Badge>}
                  {c.signupSource === 'SELF' && <Badge>website</Badge>}
                </div>
                <div className="mt-auto flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{c.planName ?? 'Custom'} · {c.billingCycle === 'ANNUAL' ? 'yearly' : 'monthly'} · {c.modules.length} modules</span>
                  <span className="tabular-nums">{c.activeEmployees}{c.maxEmployees ? `/${c.maxEmployees}` : ''} <span className="text-muted-foreground">staff</span></span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <NewCompanyDialog open={newCompany} onOpenChange={setNewCompany} />
    </>
  );
}
