'use client';

import { AlertTriangle, CalendarClock, Clock, FileText, HandCoins, Inbox, LifeBuoy, Megaphone, Receipt, Timer, UserCheck, Users, Utensils } from 'lucide-react';
import { ATTENDANCE_COLORS as C, auditActionLabel } from '@hrms/shared';
import Link from 'next/link';
import { Bars, Donut } from '@/components/ui/charts';
import { Badge, BarList, Card, CardBody, CardHeader, EmptyState, ErrorState, Progress, Skeleton, Stat, StatusBadge } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { date, dateTime, hours, money, monthLabel, relative, time } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Dash {
  today: string;
  month: string;
  currency: string;
  pendingApprovals: number;
  announcements: { id: string; title: string; body: string; createdAt: string; pinned: boolean }[];
  community: { id: string; type: string; title: string | null; body: string; createdAt: string }[];
  employee?: {
    attendance: { present: number; late: number; absent: number; leave: number; worked: number; scheduled: number; overtime: number; foodDays: number };
    today: { status: string; checkIn: string | null; checkOut: string | null; workedMinutes: number } | null;
    overtime: { availableMinutes: number; earnedMinutes: number };
    leaveBalances: { leaveTypeId: string; name: string; color: string; available: number; allocated: number; used: number; pending: number }[];
    lastPayslip: { id: string; period: string; net: number; gross: number } | null;
    kpi: { metric: string; unit: string; target: number; achieved: number | null }[];
    upcomingHolidays: { id: string; name: string; date: string }[];
    upcomingEvents: { id: string; title: string; startDate: string }[];
    hrDocuments: number;
    openQueries: number;
  };
  teamLead?: {
    memberCount: number;
    todayAttendance: Record<string, number>;
    notCheckedIn: number;
    performance: { employeeId: string; fullName: string; target: number; achieved: number }[];
    openQueries: number;
    openSurveys: number;
  };
  organisation?: {
    workforceTrend: { month: string; headcount: number; joined: number; left: number }[];
    payrollTrend: { period: string; totalNet: number; status: string }[];
    headcount: { total: number; active: number; inactive: number; resigned: number; terminated: number };
    todayAttendance: Record<string, number>;
    byDepartment: { name: string; n: number }[];
    hoursThisMonth: { worked: number; scheduled: number };
    latestPayroll: { id: string; period: string; status: string; totalNet: number; employeeCount: number } | null;
    openComplaints: number;
    draftPolicies: number;
    openQueries: number;
    pendingKpi: number;
    employeesWithoutTeam: number;
  };
  system?: {
    users: { total: number; active: number; invited: number; disabled: number };
    departments: number;
    recentAudit: { id: number; action: string; actorLabel: string | null; createdAt: string }[];
  };
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export default function DashboardPage() {
  const { me, hasModule: has } = useAuth();
  const { data: d, isLoading, error } = useApi<Dash>('/dashboard');

  if (error) return <ErrorState message={error.message} />;
  if (isLoading || !d) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const cur = d.currency;
  const e = d.employee;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{date(d.today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {greeting()}, {me?.employee?.fullName.split(' ')[0] ?? 'there'}
          </h1>
        </div>
        {d.pendingApprovals > 0 && (
          <Link href="/approvals">
            <Button>
              <Inbox className="h-4 w-4" /> {d.pendingApprovals} waiting for your approval
            </Button>
          </Link>
        )}
      </div>

      {/* ---------- Employee ---------- */}
      {e && (
        <section aria-labelledby="my-heading" className="space-y-4">
          <h2 id="my-heading" className="sr-only">
            My overview
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {has('ATTENDANCE') && <><Stat
              label="Today"
              icon={Clock}
              value={e.today ? <StatusBadge status={e.today.status} /> : <span className="text-base text-muted-foreground">Not checked in</span>}
              hint={e.today?.checkIn ? `In ${time(e.today.checkIn)}${e.today.checkOut ? ` · Out ${time(e.today.checkOut)}` : ''}` : 'Attendance from biometric device'}
            />
            <Stat label={`Hours in ${monthLabel(d.month).split(' ')[0]}`} icon={Timer} value={hours(e.attendance.worked)} hint={`of ${hours(e.attendance.scheduled)} scheduled · ${hours(e.attendance.overtime)} overtime`} />
            <Stat label="Overtime balance" icon={HandCoins} tone="success" value={hours(e.overtime.availableMinutes)} hint="Available for compensation" /></>}
            {has('PAYROLL') && <Stat label="Last salary" icon={Receipt} tone="info" value={e.lastPayslip ? money(e.lastPayslip.net, cur) : '—'} hint={e.lastPayslip ? monthLabel(e.lastPayslip.period) : 'No slips yet'} />}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {has('ATTENDANCE') && <Card className="lg:col-span-2">
              <CardHeader title="Attendance this month" action={<Link className="text-xs text-primary hover:underline" href="/attendance">View attendance</Link>} />
              <CardBody>
                <Donut
                  className="justify-center sm:justify-start"
                  center={`${e.attendance.present + e.attendance.late + e.attendance.absent + e.attendance.leave}`}
                  sub="days"
                  slices={[
                    { label: 'Present', value: e.attendance.present, color: C.PRESENT },
                    { label: 'Late', value: e.attendance.late, color: C.LATE },
                    { label: 'Absent', value: e.attendance.absent, color: C.ABSENT },
                    { label: 'On leave', value: e.attendance.leave, color: C.ON_LEAVE },
                  ]}
                />
                {has('PAYROLL') && <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                  <Utensils className="h-4 w-4" aria-hidden /> {e.attendance.foodDays} days eligible for food allowance (if enabled for your department)
                </div>}
              </CardBody>
            </Card>}
            {has('LEAVE') && <Card>
              <CardHeader title="Leave balance" action={<Link className="text-xs text-primary hover:underline" href="/leave">Apply</Link>} />
              <CardBody className="space-y-3">
                {e.leaveBalances.map((b) => (
                  <div key={b.leaveTypeId}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{b.name}</span>
                      <span className="font-medium tabular-nums">
                        {b.available} <span className="text-muted-foreground">/ {b.allocated}</span>
                      </span>
                    </div>
                    <Progress value={b.allocated ? (b.available / b.allocated) * 100 : 0} />
                    {b.pending > 0 && <p className="mt-1 text-xs text-muted-foreground">{b.pending} day(s) pending</p>}
                  </div>
                ))}
              </CardBody>
            </Card>}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {has('PERFORMANCE') && <Card>
              <CardHeader title="KPI progress" description={monthLabel(d.month)} action={<Link className="text-xs text-primary hover:underline" href="/kpi">Submit</Link>} />
              <CardBody className="space-y-3">
                {!e.kpi.length && <p className="text-sm text-muted-foreground">No targets assigned this month.</p>}
                {e.kpi.map((k) => (
                  <div key={k.metric}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{k.metric}</span>
                      <span className="tabular-nums text-muted-foreground">{k.target ? Math.round(((k.achieved ?? 0) / k.target) * 100) : 0}%</span>
                    </div>
                    <Progress value={k.target ? ((k.achieved ?? 0) / k.target) * 100 : 0} />
                  </div>
                ))}
              </CardBody>
            </Card>}
            <Card>
              <CardHeader title="Coming up" action={<Link className="text-xs text-primary hover:underline" href="/calendar">Calendar</Link>} />
              <CardBody className="space-y-2.5">
                {!e.upcomingHolidays.length && !e.upcomingEvents.length && <p className="text-sm text-muted-foreground">Nothing scheduled.</p>}
                {e.upcomingHolidays.map((h) => (
                  <div key={h.id} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" aria-hidden /> {h.name}</span>
                    <span className="text-muted-foreground">{date(h.date, { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
                {e.upcomingEvents.map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-sm">
                    <span>{ev.title}</span>
                    <span className="text-muted-foreground">{date(ev.startDate, { day: 'numeric', month: 'short' })}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Quick links" />
              <CardBody className="grid grid-cols-2 gap-2">
                {([
                  ['/profile?tab=documents', 'HR documents', FileText, e.hrDocuments, null],
                  ['/queries', 'My queries', LifeBuoy, e.openQueries, 'COMPLIANCE'],
                  ['/payslips', 'Salary slips', Receipt, null, 'PAYROLL'],
                  ['/complaints', 'Report concern', AlertTriangle, null, 'COMPLIANCE'],
                ] as const).filter((x) => !x[4] || has(x[4])).map(([href, label, Icon, n]) => {
                  const I = Icon as typeof FileText;
                  return (
                    <Link key={href as string} href={href as string} className="flex flex-col gap-1 rounded-md border p-3 text-sm hover:bg-muted">
                      <I className="h-4 w-4 text-primary" aria-hidden />
                      <span>{label as string}</span>
                      {n !== null && <span className="text-xs text-muted-foreground">{n as number} open</span>}
                    </Link>
                  );
                })}
              </CardBody>
            </Card>
          </div>
        </section>
      )}

      {/* ---------- Team Lead ---------- */}
      {d.teamLead && (
        <section aria-labelledby="team-heading" className="space-y-4">
          <h2 id="team-heading" className="text-lg font-semibold">My team</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Team members" icon={Users} value={d.teamLead.memberCount} />
            {has('ATTENDANCE') && <Stat label="In today" icon={UserCheck} tone="success" value={(d.teamLead.todayAttendance.PRESENT ?? 0) + (d.teamLead.todayAttendance.LATE ?? 0)} hint={`${d.teamLead.todayAttendance.LATE ?? 0} late · ${d.teamLead.notCheckedIn} not in`} />}
            {has('COMPLIANCE') && <Stat label="Open queries" icon={LifeBuoy} tone="warning" value={d.teamLead.openQueries} />}
            {has('COMPLIANCE') && <Stat label="Open team surveys" icon={Megaphone} tone="info" value={d.teamLead.openSurveys} />}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
          {has('ATTENDANCE') && <Card>
            <CardHeader title="Team today" description={date(d.today, { weekday: 'long', day: 'numeric', month: 'short' })} />
            <CardBody>
              <Donut center={`${d.teamLead.memberCount}`} sub="members" slices={[
                { label: 'Present', value: d.teamLead.todayAttendance.PRESENT ?? 0, color: C.PRESENT },
                { label: 'Late', value: d.teamLead.todayAttendance.LATE ?? 0, color: C.LATE },
                { label: 'On leave', value: d.teamLead.todayAttendance.ON_LEAVE ?? 0, color: C.ON_LEAVE },
                { label: 'Not in yet', value: d.teamLead.notCheckedIn, color: 'var(--muted-foreground)' },
              ]} />
            </CardBody>
          </Card>}
          {has('PERFORMANCE') && <Card className="lg:col-span-2">
            <CardHeader title="Team performance" description={`KPI achievement · ${monthLabel(d.month)}`} />
            <CardBody>
              {d.teamLead.performance.length ? (
                <BarList items={d.teamLead.performance.map((p) => ({ label: p.fullName, value: p.target ? Math.round((p.achieved / p.target) * 100) : 0 }))} format={(n) => `${n}%`} />
              ) : (
                <p className="text-sm text-muted-foreground">No members yet.</p>
              )}
            </CardBody>
          </Card>}
          </div>
        </section>
      )}

      {/* ---------- HR / Operations ---------- */}
      {d.organisation && (
        <section aria-labelledby="org-heading" className="space-y-4">
          <h2 id="org-heading" className="text-lg font-semibold">Organisation</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active employees" icon={Users} value={d.organisation.headcount.active} hint={`${d.organisation.headcount.total} registered · ${d.organisation.headcount.resigned + d.organisation.headcount.terminated} left`} />
            {has('ATTENDANCE') && <><Stat label="Present today" icon={UserCheck} tone="success" value={(d.organisation.todayAttendance.PRESENT ?? 0) + (d.organisation.todayAttendance.LATE ?? 0)} hint={`${d.organisation.todayAttendance.LATE ?? 0} late · ${d.organisation.todayAttendance.ON_LEAVE ?? 0} on leave`} />
            <Stat
              label="Hours this month"
              icon={Timer}
              tone="info"
              value={`${d.organisation.hoursThisMonth.scheduled ? Math.round((d.organisation.hoursThisMonth.worked / d.organisation.hoursThisMonth.scheduled) * 100) : 0}%`}
              hint={`${hours(d.organisation.hoursThisMonth.worked)} worked of ${hours(d.organisation.hoursThisMonth.scheduled)}`}
            /></>}
            {has('PAYROLL') && <Stat
              label="Latest payroll"
              icon={Receipt}
              tone="warning"
              value={d.organisation.latestPayroll ? money(d.organisation.latestPayroll.totalNet, cur) : '—'}
              hint={d.organisation.latestPayroll ? `${monthLabel(d.organisation.latestPayroll.period)} · ${d.organisation.latestPayroll.status.replace('_', ' ').toLowerCase()}` : 'Not processed yet'}
            />}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {has('ATTENDANCE') && <Card>
              <CardHeader title="Attendance today" />
              <CardBody>
                <Donut center={`${d.organisation.headcount.active}`} sub="active" slices={[
                  { label: 'Present', value: d.organisation.todayAttendance.PRESENT ?? 0, color: C.PRESENT },
                  { label: 'Late', value: d.organisation.todayAttendance.LATE ?? 0, color: C.LATE },
                  { label: 'Absent', value: d.organisation.todayAttendance.ABSENT ?? 0, color: C.ABSENT },
                  { label: 'On leave', value: d.organisation.todayAttendance.ON_LEAVE ?? 0, color: C.ON_LEAVE },
                ]} />
              </CardBody>
            </Card>}
            <Card className={has('ATTENDANCE') ? '' : 'lg:col-span-2'}>
              <CardHeader title="Headcount trend" description="Active employees at each month end" />
              <CardBody>
                <Bars items={d.organisation.workforceTrend.map((t) => ({ label: monthLabel(t.month).slice(0, 3), value: t.headcount, title: `${monthLabel(t.month)}: ${t.headcount} employees · +${t.joined} joined · −${t.left} left` }))} />
                <p className="mt-3 text-xs text-muted-foreground">
                  {d.organisation.workforceTrend.reduce((a, t) => a + t.joined, 0)} joined · {d.organisation.workforceTrend.reduce((a, t) => a + t.left, 0)} left in the last 6 months
                </p>
              </CardBody>
            </Card>
            {has('PAYROLL') && d.organisation.payrollTrend.length > 0 && <Card>
              <CardHeader title="Payroll cost" description="Net pay per month" action={<Link className="text-xs text-primary hover:underline" href="/payroll">Payroll</Link>} />
              <CardBody>
                <Bars format={(n) => money(n, cur)} items={d.organisation.payrollTrend.map((r) => ({ label: monthLabel(r.period).slice(0, 3), value: r.totalNet, color: r.status === 'APPROVED' || r.status === 'PAID' ? 'var(--primary)' : 'var(--muted-foreground)', title: `${monthLabel(r.period)}: ${money(r.totalNet, cur)} (${r.status.replace('_', ' ').toLowerCase()})` }))} />
              </CardBody>
            </Card>}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Employees by department" action={<Link className="text-xs text-primary hover:underline" href="/headcount">Headcount report</Link>} />
              <CardBody>
                <BarList items={d.organisation.byDepartment.map((x) => ({ label: x.name, value: x.n }))} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Needs attention" />
              <CardBody className="space-y-2 text-sm">
                {([
                  ['/complaints', 'Open complaints', d.organisation.openComplaints, 'COMPLIANCE'],
                  ['/queries', 'Open queries', d.organisation.openQueries, 'COMPLIANCE'],
                  ['/kpi', 'KPI submissions pending', d.organisation.pendingKpi, 'PERFORMANCE'],
                  ['/policies', 'Draft policies', d.organisation.draftPolicies, 'COMPLIANCE'],
                  ['/teams', 'Employees without a team', d.organisation.employeesWithoutTeam, null],
                ] as const).filter((x) => !x[3] || has(x[3])).map(([href, label, n]) => (
                  <Link key={label as string} href={href as string} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted">
                    <span>{label}</span>
                    <Badge tone={(n as number) > 0 ? 'warning' : 'neutral'}>{n as number}</Badge>
                  </Link>
                ))}
              </CardBody>
            </Card>
          </div>
        </section>
      )}

      {/* ---------- Super Admin ---------- */}
      {d.system && (
        <section aria-labelledby="sys-heading" className="space-y-4">
          <h2 id="sys-heading" className="text-lg font-semibold">System overview</h2>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Accounts" action={<Link className="text-xs text-primary hover:underline" href="/access/users">Manage</Link>} />
              <CardBody className="grid grid-cols-2 gap-4">
                {[
                  ['Active', d.system.users.active],
                  ['Invited', d.system.users.invited],
                  ['Disabled', d.system.users.disabled],
                  ['Departments', d.system.departments],
                ].map(([l, v]) => (
                  <div key={l as string}>
                    <p className="text-xs text-muted-foreground">{l}</p>
                    <p className="text-xl font-semibold tabular-nums">{v}</p>
                  </div>
                ))}
              </CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Recent activity" action={<Link className="text-xs text-primary hover:underline" href="/access/audit">Audit trail</Link>} />
              <ul className="divide-y">
                {d.system.recentAudit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="truncate">
                      <span className="font-medium">{a.actorLabel ?? 'System'}</span> <span className="text-muted-foreground">{a.actorLabel ? auditActionLabel(a.action).replace(/^./, (c) => c.toLowerCase()) : auditActionLabel(a.action)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{dateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </section>
      )}

      {/* ---------- Announcements & community ---------- */}
      {has('COMMUNITY') && <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company announcements" action={<Link className="text-xs text-primary hover:underline" href="/announcements">All</Link>} />
          {d.announcements.length ? (
            <ul className="divide-y">
              {d.announcements.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {a.pinned && <Badge tone="primary">Pinned</Badge>} {a.title}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{relative(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={Megaphone} title="No announcements yet" />
          )}
        </Card>
        <Card>
          <CardHeader title="Community updates" action={<Link className="text-xs text-primary hover:underline" href="/community">Open feed</Link>} />
          {d.community.length ? (
            <ul className="divide-y">
              {d.community.map((p) => (
                <li key={p.id} className="px-5 py-3">
                  <p className="line-clamp-2 text-sm">{p.title ?? p.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{relative(p.createdAt)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="It's quiet here" description="Posts and birthday wishes will show up here." />
          )}
        </Card>
      </div>}
    </div>
  );
}
