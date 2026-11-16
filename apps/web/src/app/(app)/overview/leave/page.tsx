'use client';

import { PERMISSIONS as P } from '@hrms/shared';
import { AlarmClock, CalendarCheck, CalendarDays, CalendarPlus, CalendarRange, Clock, Coffee, Hourglass, House, Inbox, LogIn, LogOut, Plane, Timer } from 'lucide-react';
import Link from 'next/link';
import { CalendarView } from '@/components/calendar-view';
import { QuickActions, type QuickAction } from '@/components/overview';
import { Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Progress, Skeleton, Stat, StatusBadge } from '@/components/ui/display';
import { useAuth } from '@/lib/auth';
import { date, hours, relative, time } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface MyRequest { id: string; kind: 'LEAVE' | 'WORK_FROM_HOME'; label: string; color: string; startDate: string; endDate: string; days: number | null; status: string; currentStep: string | null; createdAt: string }

interface LeaveOverview {
  scope: 'company' | 'team' | 'self';
  pending: number;
  approvedThisMonth: number;
  onLeaveToday: number;
  upcoming: number;
  balances: { leaveTypeId: string; name: string; color: string; available: number; allocated: number; used: number; pending: number }[];
  recent: { id: string; employeeName: string; typeName: string; typeColor: string; startDate: string; endDate: string; status: string; currentStep: string | null }[];
  /** The signed-in person's own numbers (null without an employee profile). */
  me?: {
    today: { status: string; checkIn: string | null; checkOut: string | null; workedMinutes: number; scheduledMinutes: number; breakMinutes: number; lateMinutes: number; workFromHome: boolean } | null;
    workingFromHomeToday: boolean;
    leaveAvailable: number;
    leaveUsed: number;
    leavePendingDays: number;
    wfhPending: number;
    requests: MyRequest[];
  } | null;
}

interface InboxItem { workflow: string; label: string; id: string; employeeName: string; step: string; createdAt: string; link: string }

const SCOPE: Record<LeaveOverview['scope'], string> = { company: 'Across the company', team: 'You and your team', self: 'Your own leave and attendance' };
const range = (r: { startDate: string; endDate: string }) => `${date(r.startDate, { day: 'numeric', month: 'short' })}${r.endDate !== r.startDate ? ` – ${date(r.endDate, { day: 'numeric', month: 'short' })}` : ''}`;
const LEAVE_FLOWS = ['LEAVE', 'WORK_FROM_HOME'];

/**
 * Attendance & leave overview, in this order: the full month calendar, my own stats (leave and today's attendance),
 * my submitted requests and anything waiting for my approval, quick actions, then team / company numbers.
 */
export default function LeaveOverviewPage() {
  const { can, isTeamLead, hasModule, me } = useAuth();
  const { data, isLoading, error } = useApi<LeaveOverview>('/leave/overview', { fresh: true });
  const approver = can(P.LEAVE_APPROVE_HR) || isTeamLead;
  const { data: inbox } = useApi<InboxItem[]>(approver ? '/approvals/inbox' : null, { fresh: true });
  const waiting = (inbox ?? []).filter((i) => LEAVE_FLOWS.includes(i.workflow));
  const attendance = hasModule('ATTENDANCE');

  const actions: QuickAction[] = [
    ...(me?.employee ? [{ href: '/leave', label: 'Apply for leave', description: 'Send a request', icon: CalendarPlus }, { href: '/leave?tab=wfh', label: 'Work from home', description: 'Apply or check your requests', icon: House }] : []),
    ...(approver ? [{ href: '/leave?tab=approvals', label: 'Approvals', description: 'Leave and work from home waiting for you', icon: Inbox }] : []),
    ...(attendance ? [{ href: '/attendance', label: 'My attendance', description: 'Check-ins, breaks and hours', icon: Clock }, { href: '/overtime', label: 'Overtime', icon: Timer }] : []),
    { href: '/calendar', label: 'Calendar', description: 'Leave, holidays and events', icon: CalendarDays },
  ];

  if (error) return <><PageHeader title="Attendance & leave" /><ErrorState message={error.message} /></>;
  if (isLoading || !data) return <><PageHeader title="Attendance & leave" /><Skeleton className="h-64" /></>;
  const t = data.me?.today;

  return (
    <>
      <PageHeader title="Attendance & leave" description={SCOPE[data.scope]} />
      <div className="space-y-4">
        {/* 1. Full calendar first: my attendance, leave, work from home, holidays, events and birthdays. */}
        <CalendarView />

        {/* 2. My stats */}
        {data.me && (
          <section aria-labelledby="my-stats" className="space-y-2">
            <h2 id="my-stats" className="text-sm font-semibold text-muted-foreground">My stats</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label="Leave available" icon={CalendarCheck} tone="success" value={`${data.me.leaveAvailable}`} hint={`days · ${data.me.leaveUsed} used this year`} />
              <Stat label="Pending" icon={Hourglass} tone="warning" value={`${data.me.leavePendingDays}`} hint={`leave days · ${data.me.wfhPending} WFH request${data.me.wfhPending === 1 ? '' : 's'}`} />
              {attendance && <>
                <Stat label="Check-in" icon={LogIn} tone="info"
                  value={t?.checkIn ? time(t.checkIn) : <span className="text-base text-muted-foreground">{data.me.workingFromHomeToday ? 'Working from home' : 'Not yet'}</span>}
                  hint={t ? <StatusBadge status={t.status} /> : 'Today'} />
                <Stat label="Check-out" icon={LogOut} value={t?.checkOut ? time(t.checkOut) : <span className="text-base text-muted-foreground">Not yet</span>} hint={t?.workedMinutes ? `${hours(t.workedMinutes)} worked of ${hours(t.scheduledMinutes)}` : 'Today'} />
                <Stat label="Break" icon={Coffee} value={t ? hours(t.breakMinutes) : '—'} hint="Today" />
                <Stat label="Late" icon={AlarmClock} tone={t?.lateMinutes ? 'danger' : 'success'} value={t ? `${t.lateMinutes}m` : '—'} hint={t?.lateMinutes ? 'After shift start today' : 'On time'} />
              </>}
            </div>
          </section>
        )}

        {/* 3. My requests and approvals waiting for me */}
        {(data.me || approver) && (
          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
            {data.me && (
              <Card>
                <CardHeader title="My requests" description="Leave and work from home you submitted" action={<Link className="text-xs text-primary hover:underline" href="/leave">All</Link>} />
                {data.me.requests.length ? (
                  <ul className="divide-y">
                    {data.me.requests.map((r) => (
                      <li key={`${r.kind}-${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
                          <span className="min-w-0"><span className="block truncate font-medium">{r.label}</span><span className="block text-xs text-muted-foreground">{range(r)}{r.days !== null ? ` · ${r.days} day${r.days === 1 ? '' : 's'}` : ''} · sent {relative(r.createdAt)}</span></span>
                        </span>
                        <StatusBadge status={r.status} step={r.currentStep} />
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={CalendarRange} title="No requests yet" description="Leave and work-from-home requests you send appear here with their status." />}
              </Card>
            )}
            {approver && (
              <Card>
                <CardHeader title="Waiting for your approval" description={`${waiting.length} leave and work-from-home request${waiting.length === 1 ? '' : 's'}`} action={<Link className="text-xs text-primary hover:underline" href="/leave?tab=approvals">Review</Link>} />
                {waiting.length ? (
                  <ul className="divide-y">
                    {waiting.slice(0, 6).map((i) => (
                      <li key={`${i.workflow}-${i.id}`}>
                        <Link href="/leave?tab=approvals" className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm hover:bg-muted/50">
                          <span className="min-w-0"><span className="block truncate font-medium">{i.employeeName}</span><span className="block text-xs text-muted-foreground">{i.label} · {relative(i.createdAt)}</span></span>
                          <StatusBadge status="PENDING" step={i.step} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState icon={Inbox} title="Nothing waiting" description="New leave and work-from-home requests for you appear here." />}
              </Card>
            )}
          </div>
        )}

        {/* 4. Quick actions and my balances side by side */}
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <QuickActions actions={actions} columns={2} />
          {data.balances.length > 0 && (
            <Card>
              <CardHeader title="My balances" action={<Link className="text-xs text-primary hover:underline" href="/leave">Apply</Link>} />
              <CardBody className="space-y-3">
                {data.balances.map((b) => (
                  <div key={b.leaveTypeId}>
                    <div className="mb-1 flex justify-between text-sm"><span>{b.name}</span><span className="font-medium tabular-nums">{b.available} <span className="text-muted-foreground">/ {b.allocated}</span></span></div>
                    <Progress value={b.allocated ? (b.available / b.allocated) * 100 : 0} />
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>

        {/* 5. Team / company numbers for approvers */}
        {data.scope !== 'self' && (
          <section aria-labelledby="scope-kpis" className="space-y-2">
            <h2 id="scope-kpis" className="text-sm font-semibold text-muted-foreground">{data.scope === 'company' ? 'Company' : 'My team'}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Pending requests" icon={Hourglass} tone="warning" value={data.pending} hint="Leave waiting for approval" />
              <Stat label="Approved this month" icon={CalendarCheck} tone="success" value={data.approvedThisMonth} />
              <Stat label="On leave today" icon={Plane} tone="info" value={data.onLeaveToday} />
              <Stat label="Upcoming (30 days)" icon={CalendarRange} value={data.upcoming} hint="Approved leave starting soon" />
            </div>
          </section>
        )}

        {/* 6. The latest leave in my scope (Team Leads / HR) */}
        <div className="grid gap-3">
          {data.scope !== 'self' && (
            <Card>
              <CardHeader title={data.scope === 'company' ? 'Latest leave requests' : 'Latest from my team'} action={<Link className="text-xs text-primary hover:underline" href="/leave?tab=approvals">All requests</Link>} />
              {data.recent.length ? (
                <ul className="divide-y">
                  {data.recent.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.typeColor }} aria-hidden />
                        <span className="min-w-0"><span className="block truncate font-medium">{r.employeeName}</span><span className="block text-xs text-muted-foreground">{r.typeName} · {range(r)}</span></span>
                      </span>
                      <StatusBadge status={r.status} step={r.currentStep} />
                    </li>
                  ))}
                </ul>
              ) : <EmptyState icon={CalendarRange} title="No leave requests yet" />}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
