'use client';

import { AlertTriangle, CalendarClock, CalendarDays, CalendarRange, Clock, Contact, FileText, Fingerprint, HandCoins, House, Inbox, LifeBuoy, Megaphone, Receipt, Target, Timer, TrendingUp, UserCheck, UserRound, Users, Utensils } from 'lucide-react';
import { ATTENDANCE_COLORS as C, auditActionLabel } from '@hrms/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarView } from '@/components/calendar-view';
import { PunchClock } from '@/components/punch-clock';
import { Bars, Donut } from '@/components/ui/charts';
import { Avatar, Badge, BarList, Card, CardBody, CardHeader, EmptyState, ErrorState, Progress, Skeleton, Stat, StatusBadge } from '@/components/ui/display';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';
import { cn, date, dateTime, hours, money, monthLabel, relative, time } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Dash {
  today: string;
  month: string;
  currency: string;
  pendingApprovals: number;
  announcements: { id: string; title: string; body: string; createdAt: string; pinned: boolean }[];
  community: { id: string; type: string; title: string | null; body: string; createdAt: string }[];
  employee?: {
    signIn: SignIn;
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
  /** Only for the Sales department and people given "View sales revenue". */
  sales?: {
    totals: { target: number; achieved: number; pending: number; progress: number | null; incentives: number; people: number };
    trend: { period: string; target: number; achieved: number }[];
  };
  system?: {
    users: { total: number; active: number; invited: number; disabled: number };
    departments: number;
    recentAudit: { id: number; action: string; actorLabel: string | null; createdAt: string }[];
  };
}

interface SignIn {
  /** DEVICE (biometric), IMPORT, MANUAL, CORRECTION, HOME (approved work from home) or null (not signed in). */
  source: string | null;
  workFromHome: boolean;
  checkIn: string | null;
  checkOut: string | null;
  workingDay: boolean;
  shift: { startTime: string; endTime: string; breakMinutes: number; netMinutes: number };
}

const SIGN_IN_LABEL: Record<string, string> = {
  DEVICE: 'Signed in from biometric device',
  HOME: 'Signed in from home',
  IMPORT: 'Signed in (imported attendance)',
  MANUAL: 'Signed in (added by HR)',
  CORRECTION: 'Signed in (corrected attendance)',
  WEB: 'Signed in from the app',
};
const hm = (mins: number) => `${Math.floor(mins / 60)}h ${String(Math.max(0, Math.round(mins % 60))).padStart(2, '0')}m`;

/** Photo, name and designation, how I signed in today, and a live time passed / remaining bar. */
function MyDayCard({ signIn, status, showAttendance }: { signIn: SignIn; status: string | null; showAttendance: boolean }) {
  const { me } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const emp = me?.employee;
  // Without a punch, an approved work-from-home day counts from the shift start.
  const start = signIn.checkIn ? new Date(signIn.checkIn).getTime() : signIn.workFromHome && signIn.workingDay ? (() => { const d = new Date(); const [h, m] = signIn.shift.startTime.split(':').map(Number) as [number, number]; d.setHours(h, m, 0, 0); return d.getTime(); })() : null;
  const end = signIn.checkOut ? new Date(signIn.checkOut).getTime() : now;
  const target = signIn.shift.netMinutes + signIn.shift.breakMinutes; // time at work including the break
  const passed = start && end > start ? (end - start) / 60_000 : 0;
  const remaining = Math.max(0, target - passed);
  const label = signIn.source ? SIGN_IN_LABEL[signIn.source] ?? 'Signed in' : signIn.workingDay ? 'Not signed in yet' : 'Day off today';

  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-4 p-4">
        <Avatar name={emp?.fullName} fileId={emp?.avatarFileId} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold">{emp?.fullName}</p>
          <p className="truncate text-sm text-muted-foreground">{emp?.designation}{emp?.departmentName ? ` · ${emp.departmentName}` : ''}</p>
          {showAttendance && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', signIn.source === 'HOME' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : signIn.source ? 'bg-success-soft text-success' : 'bg-muted text-muted-foreground')}>
                {signIn.source === 'HOME' ? <House className="h-3.5 w-3.5" aria-hidden /> : signIn.source ? <Fingerprint className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                {label}{signIn.checkIn ? ` at ${time(signIn.checkIn)}` : ''}
              </span>
              {status && <StatusBadge status={status} />}
              {signIn.checkOut && <span className="text-xs text-muted-foreground">Signed out at {time(signIn.checkOut)}</span>}
            </p>
          )}
        </div>
        {showAttendance && signIn.workingDay && (
          <div className="w-full sm:w-72">
            {start ? (
              <>
                <div className="flex justify-between text-sm">
                  <span><span className="text-muted-foreground">Time passed</span> <strong className="tabular-nums">{hm(passed)}</strong></span>
                  <span>{signIn.checkOut ? <span className="text-muted-foreground">Day complete</span> : remaining > 0 ? <><span className="text-muted-foreground">Remaining</span> <strong className="tabular-nums">{hm(remaining)}</strong></> : <span className="text-success">Shift complete</span>}</span>
                </div>
                <Progress className="mt-1.5" value={target ? Math.min(100, (passed / target) * 100) : 0} />
                <p className="mt-1 text-xs text-muted-foreground">Shift {signIn.shift.startTime}–{signIn.shift.endTime} · {hm(signIn.shift.breakMinutes)} break</p>
              </>
            ) : <p className="text-sm text-muted-foreground">Shift {signIn.shift.startTime}–{signIn.shift.endTime}. The timer starts when you sign in.</p>}
          </div>
        )}
        {showAttendance && (
          <div className="w-full border-t pt-3">
            {/* Sign in (or from home), take a break and sign out right here. */}
            <PunchClock />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** The same calendar as the Calendar page (filtered by the server for this person), in its short form. */
function DashboardCalendar() {
  return (
    <section aria-labelledby="cal-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 id="cal-heading" className="text-sm font-semibold text-muted-foreground">Calendar</h2>
        <Link className="text-xs text-primary hover:underline" href="/calendar">Open full calendar</Link>
      </div>
      <CalendarView compact />
    </section>
  );
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
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
        <section aria-labelledby="my-heading" className="space-y-3">
          <h2 id="my-heading" className="sr-only">
            My overview
          </h2>
          {/* Who I am and how today is going: sign-in source, time passed and time remaining. */}
          <MyDayCard signIn={e.signIn} status={e.today?.status ?? null} showAttendance={has('ATTENDANCE')} />
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            {has('ATTENDANCE') && <><Stat label={`Hours in ${monthLabel(d.month).split(' ')[0]}`} icon={Timer} value={hours(e.attendance.worked)} hint={`of ${hours(e.attendance.scheduled)} scheduled · ${hours(e.attendance.overtime)} overtime`} />
            <Stat label="Overtime balance" icon={HandCoins} tone="success" value={hours(e.overtime.availableMinutes)} hint="Available for compensation" /></>}
            {has('PAYROLL') && <Stat label="Last salary" icon={Receipt} tone="info" value={e.lastPayslip ? money(e.lastPayslip.net, cur) : '—'} hint={e.lastPayslip ? monthLabel(e.lastPayslip.period) : 'No slips yet'} />}
          </div>

          {/* Stats, then the calendar, then quick links. */}
          <DashboardCalendar />

          {/* Quick links: their own full-width row. Links every plan has, plus module links when the plan includes them. */}
          <Card>
            <CardHeader title="Quick links" />
            <CardBody className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
              {([
                ['/profile', 'My profile', UserRound, null, null],
                ['/profile?tab=documents', 'HR documents', FileText, `${e.hrDocuments} shared`, null],
                ['/leave', 'Apply for leave', CalendarRange, null, 'LEAVE'],
                ['/leave?tab=wfh', 'Work from home', House, null, 'LEAVE'],
                ['/attendance', 'My attendance', Clock, null, 'ATTENDANCE'],
                ['/payslips', 'Salary slips', Receipt, null, 'PAYROLL'],
                ['/queries', 'My queries', LifeBuoy, `${e.openQueries} open`, 'COMPLIANCE'],
                ['/complaints', 'Report concern', AlertTriangle, null, 'COMPLIANCE'],
                ['/calendar', 'Calendar', CalendarDays, null, null],
                ['/directory', 'Directory', Contact, null, null],
              ] as const).filter((x) => !x[4] || has(x[4])).map(([href, label, Icon, note]) => {
                const I = Icon as typeof FileText;
                return (
                  <Link key={href as string} href={href as string} className="flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-sm hover:bg-muted">
                    <I className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate">{label as string}</span>
                      {note !== null && <span className="block text-xs text-muted-foreground">{note as string}</span>}
                    </span>
                  </Link>
                );
              })}
            </CardBody>
          </Card>

          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
            {has('ATTENDANCE') && <Card className="lg:col-span-2">
              <CardHeader title="Attendance this month" action={<Link className="text-xs text-primary hover:underline" href="/attendance">View attendance</Link>} />
              <CardBody>
                <Donut size="sm"
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

          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
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
          </div>
        </section>
      )}

      {/* Without an employee profile (e.g. a Company Admin) the calendar sits here; employees get it under their stats. */}
      {!e && <DashboardCalendar />}

      {/* ---------- Sales revenue (Sales department / permitted roles only) ---------- */}
      {d.sales && (
        <section aria-labelledby="sales-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="sales-heading" className="text-lg font-semibold">Sales revenue</h2>
            <Link className="text-xs text-primary hover:underline" href="/overview/sales">Sales overview</Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            <Stat label={`Revenue in ${monthLabel(d.month).split(' ')[0]}`} icon={TrendingUp} tone="success" value={money(d.sales.totals.achieved, cur)} hint="Approved KPI results" />
            <Stat label="Target" icon={Target} value={money(d.sales.totals.target, cur)} hint={`${d.sales.totals.people} people with sales targets`} />
            <Stat label="Achieved" icon={UserCheck} tone="info" value={d.sales.totals.progress === null ? '—' : `${d.sales.totals.progress}%`} hint={`${money(d.sales.totals.pending, cur)} awaiting approval`} />
            <Stat label="Incentives earned" icon={HandCoins} tone="warning" value={money(d.sales.totals.incentives, cur)} />
          </div>
        </section>
      )}

      {/* ---------- Team Lead ---------- */}
      {d.teamLead && (
        <section aria-labelledby="team-heading" className="space-y-3">
          <h2 id="team-heading" className="text-lg font-semibold">My team</h2>
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
            <Stat label="Team members" icon={Users} value={d.teamLead.memberCount} />
            {has('ATTENDANCE') && <Stat label="In today" icon={UserCheck} tone="success" value={(d.teamLead.todayAttendance.PRESENT ?? 0) + (d.teamLead.todayAttendance.LATE ?? 0)} hint={`${d.teamLead.todayAttendance.LATE ?? 0} late · ${d.teamLead.notCheckedIn} not in`} />}
            {has('COMPLIANCE') && <Stat label="Open queries" icon={LifeBuoy} tone="warning" value={d.teamLead.openQueries} />}
            {has('COMPLIANCE') && <Stat label="Open team surveys" icon={Megaphone} tone="info" value={d.teamLead.openSurveys} />}
          </div>
          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
          {has('ATTENDANCE') && <Card>
            <CardHeader title="Team today" description={date(d.today, { weekday: 'long', day: 'numeric', month: 'short' })} />
            <CardBody>
              <Donut size="sm" center={`${d.teamLead.memberCount}`} sub="members" slices={[
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
        <section aria-labelledby="org-heading" className="space-y-3">
          <h2 id="org-heading" className="text-lg font-semibold">Organisation</h2>
          <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
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
          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
            {has('ATTENDANCE') && <Card>
              <CardHeader title="Attendance today" />
              <CardBody>
                <Donut size="sm" center={`${d.organisation.headcount.active}`} sub="active" slices={[
                  { label: 'Present', value: d.organisation.todayAttendance.PRESENT ?? 0, color: C.PRESENT },
                  { label: 'Late', value: d.organisation.todayAttendance.LATE ?? 0, color: C.LATE },
                  { label: 'Absent', value: d.organisation.todayAttendance.ABSENT ?? 0, color: C.ABSENT },
                  { label: 'On leave', value: d.organisation.todayAttendance.ON_LEAVE ?? 0, color: C.ON_LEAVE },
                ]} />
              </CardBody>
            </Card>}
            <Card>
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
          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
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
        <section aria-labelledby="sys-heading" className="space-y-3">
          <h2 id="sys-heading" className="text-lg font-semibold">System overview</h2>
          <div className="grid gap-3 lg:auto-cols-fr lg:grid-flow-col">
            <Card>
              <CardHeader title="Accounts" action={<Link className="text-xs text-primary hover:underline" href="/access/users">Manage</Link>} />
              <CardBody className="grid grid-cols-2 gap-3">
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
      {has('COMMUNITY') && <div className="grid gap-3 lg:grid-cols-2">
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
