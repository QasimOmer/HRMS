'use client';

import { ChevronRight, Plus, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { CompanyLogo } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Badge, Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/display';
import { Input } from '@/components/ui/form';
import { useApi } from '@/lib/hooks';
import { NewCompanyDialog, PlatformNav, usePlatformMe, type CompanyRow } from './shared';
import { RecentLeads } from './billing';
import { BillingStatusBadge } from '@/components/billing-status';

/** Landing page after a platform owner signs in: pick a company, or open platform-wide settings. */
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
      <PageHeader title="Choose a company" description="Open a company to manage its plan, modules and Company Admins, or change settings that apply to all companies."
        actions={<Button onClick={() => setNewCompany(true)}><Plus className="h-4 w-4" /> New company</Button>} />

      <RecentLeads />

      <Link href="/platform/settings" className="mb-6 flex items-center gap-4 rounded-xl border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-primary-soft/40">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-soft text-primary"><Settings className="h-5 w-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">General settings for all companies</span>
          <span className="block text-sm text-muted-foreground">Plans and pricing, Super Admins and outgoing email.</span>
        </span>
        <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
      </Link>

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
