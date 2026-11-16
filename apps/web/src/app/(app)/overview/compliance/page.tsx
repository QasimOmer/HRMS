'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { FileText, FilePen, LifeBuoy, MessageSquareWarning, ScrollText, ShieldAlert, Vote } from 'lucide-react';
import Link from 'next/link';
import { QuickActions, type QuickAction } from '@/components/overview';
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat, StatusBadge } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { date, humanize, relative } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface ComplianceOverview {
  publishedPolicies: number;
  recentPolicies: { id: string; title: string; category: string; updatedAt: string }[];
  myOpenQueries?: number;
  assignedOpenQueries?: number;
  myQueries?: { id: string; subject: string; status: string; updatedAt: string }[];
  draftPolicies?: number;
  openComplaints?: number;
  openQueriesAll?: number;
}

/** Compliance overview: my numbers first, then (for managers) what needs attention, quick actions and recent items. */
export default function ComplianceOverviewPage() {
  const { can, hasModule } = useAuth();
  const { data, isLoading, error } = useApi<ComplianceOverview>('/compliance/overview', { fresh: true });
  const { data: surveys } = useApi<{ id: string }[]>('/surveys/available');

  const actions: QuickAction[] = [
    { href: '/policies', label: 'Policies & documents', description: 'Read company policies', icon: FileText },
    { href: '/queries', label: 'Raise a query', description: 'Ask HR or your Team Lead', icon: LifeBuoy },
    { href: '/complaints', label: 'Report a concern', description: 'Anonymous complaint', icon: MessageSquareWarning },
    { href: '/surveys', label: 'Surveys', description: 'Share your feedback', icon: Vote },
    ...(hasModule('COMMUNITY') ? [{ href: '/guidelines', label: 'Community guidelines', icon: ScrollText }] : []),
  ];

  return (
    <>
      <PageHeader title="Compliance" description="Policies, queries, concerns and surveys." />
      {error ? <ErrorState message={error.message} /> : isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-4">
          <section aria-labelledby="mine" className="space-y-2">
            <h2 id="mine" className="text-sm font-semibold text-muted-foreground">For me</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Policies to read" icon={FileText} value={data.publishedPolicies} hint="Published documents" />
              {data.myOpenQueries !== undefined && <Stat label="My open queries" icon={LifeBuoy} tone="info" value={data.myOpenQueries} />}
              <Stat label="Surveys waiting" icon={Vote} tone="success" value={surveys?.length ?? '…'} hint="Open surveys for you" />
              {!!data.assignedOpenQueries && <Stat label="Queries assigned to me" icon={LifeBuoy} tone="warning" value={data.assignedOpenQueries} />}
            </div>
          </section>

          {(data.draftPolicies !== undefined || data.openComplaints !== undefined || data.openQueriesAll !== undefined) && (
            <section aria-labelledby="attention" className="space-y-2">
              <h2 id="attention" className="text-sm font-semibold text-muted-foreground">Needs attention</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.openComplaints !== undefined && <Link className="block rounded-lg transition-opacity hover:opacity-90" href="/complaints"><Stat label="Open complaints" icon={ShieldAlert} tone="danger" value={data.openComplaints} hint="Submitted or under review" /></Link>}
                {data.openQueriesAll !== undefined && <Link className="block rounded-lg transition-opacity hover:opacity-90" href="/queries"><Stat label="Open queries (company)" icon={LifeBuoy} tone="warning" value={data.openQueriesAll} /></Link>}
                {data.draftPolicies !== undefined && can(P.POLICIES_MANAGE) && <Link className="block rounded-lg transition-opacity hover:opacity-90" href="/policies"><Stat label="Draft policies" icon={FilePen} value={data.draftPolicies} hint="Not published yet" /></Link>}
              </div>
            </section>
          )}

          <QuickActions actions={actions} />

          <div className="grid gap-3 lg:grid-cols-2">
            {data.myQueries && (
              <Card>
                <CardHeader title="My queries" action={<Link className="text-xs text-primary hover:underline" href="/queries">All</Link>} />
                {data.myQueries.length ? (
                  <ul className="divide-y">
                    {data.myQueries.map((q) => (
                      <li key={q.id}>
                        <Link href={`/queries/${q.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/50">
                          <span className="min-w-0"><span className="block truncate font-medium">{q.subject}</span><span className="block text-xs text-muted-foreground">Updated {relative(q.updatedAt)}</span></span>
                          <StatusBadge status={q.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={LifeBuoy} title="No queries yet" description="Ask HR or your Team Lead from Queries & support." />}
              </Card>
            )}
            <Card>
              <CardHeader title="Latest policies" action={<Link className="text-xs text-primary hover:underline" href="/policies">All</Link>} />
              {data.recentPolicies.length ? (
                <ul className="divide-y">
                  {data.recentPolicies.map((p) => (
                    <li key={p.id}>
                      <Link href={`/policies/${p.id}`} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/50">
                        <span className="min-w-0"><span className="block truncate font-medium">{p.title}</span><span className="block text-xs text-muted-foreground">{humanize(p.category)}</span></span>
                        <span className="shrink-0 text-xs text-muted-foreground">{date(p.updatedAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState icon={FileText} title="No published policies yet" />}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
