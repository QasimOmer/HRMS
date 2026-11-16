'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { Banknote, CalendarRange, CheckCircle2, Clock, Hourglass, House, Inbox, Target, Timer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { QuickActions, type QuickAction } from '@/components/overview';
import { Card, CardHeader, EmptyState, PageHeader, Stat, StatusBadge } from '@/components/ui/display';
import { DataTable } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import { relative } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Item {
  workflow: string;
  label: string;
  id: string;
  employeeName: string;
  step: string;
  createdAt: string;
  link: string;
}

/** Everything waiting on me: counts first, shortcuts to each approval area, then the list. */
export default function ApprovalsPage() {
  const router = useRouter();
  const { can, isTeamLead, hasModule } = useAuth();
  const { data, isLoading, error } = useApi<Item[]>('/approvals/inbox', { fresh: true });

  const stats = useMemo(() => {
    const items = data ?? [];
    const n = (...w: string[]) => items.filter((i) => w.includes(i.workflow)).length;
    const oldest = items.reduce<string | null>((a, i) => (!a || i.createdAt < a ? i.createdAt : a), null);
    return { total: items.length, leave: n('LEAVE', 'WORK_FROM_HOME'), attendance: n('ATTENDANCE_CORRECTION', 'OVERTIME', 'COMPENSATION'), other: items.length - n('LEAVE', 'WORK_FROM_HOME', 'ATTENDANCE_CORRECTION', 'OVERTIME', 'COMPENSATION'), oldest };
  }, [data]);

  const leaveApprover = can(P.LEAVE_APPROVE_HR) || (isTeamLead && can(P.LEAVE_APPROVE_TL));
  const actions: QuickAction[] = [
    ...(leaveApprover && hasModule('LEAVE') ? [{ href: '/leave?tab=approvals', label: 'Leave & work from home', description: 'Requests and cancellations', icon: CalendarRange }] : []),
    ...(hasModule('ATTENDANCE') && (can(P.ATTENDANCE_CORRECTION_APPROVE_HR) || isTeamLead) ? [{ href: '/attendance/corrections', label: 'Attendance corrections', icon: Clock }] : []),
    ...(hasModule('ATTENDANCE') && (can(P.COMPENSATION_APPROVE_HR) || isTeamLead) ? [{ href: '/overtime', label: 'Overtime & compensation', icon: Timer }] : []),
    ...(hasModule('PERFORMANCE') && (can(P.KPI_APPROVE_HR) || isTeamLead) ? [{ href: '/kpi', label: 'KPI submissions', icon: Target }] : []),
    ...(hasModule('PAYROLL') && (can(P.PAYROLL_APPROVE_HR) || can(P.PAYROLL_APPROVE_OPS)) ? [{ href: '/payroll', label: 'Payroll runs', icon: Banknote }] : []),
  ];

  return (
    <>
      <PageHeader title="Approvals" description="Everything waiting for your decision across leave, work from home, attendance, overtime, KPIs, payroll and more." />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Waiting for you" icon={Inbox} value={isLoading ? '…' : stats.total} hint={stats.oldest ? `Oldest ${relative(stats.oldest)}` : 'Nothing pending'} />
          <Stat label="Leave & work from home" icon={House} tone="info" value={isLoading ? '…' : stats.leave} />
          <Stat label="Attendance & overtime" icon={Clock} tone="warning" value={isLoading ? '…' : stats.attendance} />
          <Stat label="Other requests" icon={Hourglass} tone="success" value={isLoading ? '…' : stats.other} hint="KPIs, payroll, resignations…" />
        </div>
        <QuickActions actions={actions} />
        <Card>
          <CardHeader title="Waiting for your decision" description="Oldest first. Open one to decide." />
          {!isLoading && !error && !data?.length ? (
            <EmptyState icon={CheckCircle2} title="You're all caught up" description="New requests that need your approval will appear here." />
          ) : (
            <DataTable
              loading={isLoading}
              error={error}
              rows={data}
              rowKey={(r) => `${r.workflow}-${r.id}`}
              onRowClick={(r) => router.push(r.link)}
              columns={[
                { key: 'type', header: 'Request', cell: (r) => <span className="font-medium">{r.label}</span> },
                { key: 'who', header: 'From', cell: (r) => r.employeeName || '—' },
                { key: 'step', header: 'Your step', cell: (r) => <StatusBadge status="PENDING" step={r.step} /> },
                { key: 'when', header: 'Submitted', cell: (r) => <span className="text-muted-foreground">{relative(r.createdAt)}</span>, hideOnMobile: true },
              ]}
            />
          )}
        </Card>
      </div>
    </>
  );
}
