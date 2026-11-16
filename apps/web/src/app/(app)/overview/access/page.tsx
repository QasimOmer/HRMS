'use client';

import { PERMISSIONS as P, auditActionLabel } from '@hrms/shared';
import { History, KeyRound, Lock, MailQuestion, ShieldAlert, ShieldCheck, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { QuickActions, type QuickAction } from '@/components/overview';
import { BarList, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, Stat } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface AccessOverview {
  accounts?: { total: number; active: number; invited: number; disabled: number; locked: number; neverSignedIn: number };
  roles?: { role: string; label: string; users: number }[];
  activity?: { lastWeek: number; failedSignIns: number; recent: { id: number; action: string; actorLabel: string | null; createdAt: string }[] };
}

/** Access & roles overview: accounts, roles and recent activity, then shortcuts to the existing pages. */
export default function AccessOverviewPage() {
  const { can } = useAuth();
  const { data, isLoading, error } = useApi<AccessOverview>('/access/overview', { fresh: true });
  const actions: QuickAction[] = [
    ...(can(P.USERS_MANAGE_ACCESS) ? [{ href: '/access/users', label: 'Users & access', description: 'Roles, sign-in and passwords', icon: KeyRound }] : []),
    ...(can(P.ROLES_MANAGE) ? [{ href: '/access/roles', label: 'Roles & permissions', description: 'What each role can do', icon: ShieldCheck }] : []),
    ...(can(P.AUDIT_READ) ? [{ href: '/access/audit', label: 'Audit trail', description: 'Every change, who and when', icon: History }] : []),
  ];

  return (
    <>
      <PageHeader title="Access & roles" description="Who can sign in, what they can do, and what changed recently." />
      {error ? <ErrorState message={error.message} /> : isLoading || !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.accounts && <>
              <Stat label="Active accounts" icon={UserCheck} tone="success" value={data.accounts.active} hint={`${data.accounts.total} accounts in total`} />
              <Stat label="Invited, not set up" icon={MailQuestion} tone="info" value={data.accounts.invited} hint={`${data.accounts.neverSignedIn} never signed in`} />
              <Stat label="Disabled" icon={Users} value={data.accounts.disabled} />
              <Stat label="Locked right now" icon={Lock} tone="warning" value={data.accounts.locked} hint="After failed sign-ins" />
            </>}
            {data.activity && !data.accounts && <>
              <Stat label="Changes this week" icon={History} value={data.activity.lastWeek} />
              <Stat label="Failed sign-ins this week" icon={ShieldAlert} tone="warning" value={data.activity.failedSignIns} />
            </>}
          </div>
          <QuickActions actions={actions} />
          <div className="grid gap-4 lg:grid-cols-3">
            {data.roles && (
              <Card>
                <CardHeader title="People per role" action={can(P.ROLES_MANAGE) ? <Link className="text-xs text-primary hover:underline" href="/access/roles">Permissions</Link> : undefined} />
                <CardBody><BarList items={data.roles.map((r) => ({ label: r.label, value: r.users }))} /></CardBody>
              </Card>
            )}
            {data.activity && (
              <Card className={data.roles ? 'lg:col-span-2' : 'lg:col-span-3'}>
                <CardHeader title="Recent activity" description={`${data.activity.lastWeek} changes and ${data.activity.failedSignIns} failed sign-ins in the last 7 days`} action={<Link className="text-xs text-primary hover:underline" href="/access/audit">Audit trail</Link>} />
                {data.activity.recent.length ? (
                  <ul className="divide-y">
                    {data.activity.recent.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                        <span className="min-w-0 truncate"><span className="font-medium">{a.actorLabel ?? 'System'}</span> <span className="text-muted-foreground">{auditActionLabel(a.action).replace(/^./, (c) => c.toLowerCase())}</span></span>
                        <span className="shrink-0 text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={History} title="No activity yet" />}
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
