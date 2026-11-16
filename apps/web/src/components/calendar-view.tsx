'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, Skeleton } from '@/components/ui/display';
import { Dialog } from '@/components/ui/overlay';
import { qs } from '@/lib/api';
import { cn, hours, monthLabel, time, todayLocal } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export interface CalendarData {
  colors: Record<string, string>;
  holidays: { id: string; name: string; date: string }[];
  events: { id: string; title: string; startDate: string; endDate: string; visibility: string; description: string | null }[];
  attendance: { date: string; status: string; workedMinutes: number; overtimeMinutes: number; lateMinutes: number; checkIn: string | null; checkOut: string | null }[];
  leaves: { id: string; startDate: string; endDate: string; status: string; currentStep: string | null; cancellationStatus: string | null; typeName: string; color: string; halfDay: boolean }[];
  overtime: { date: string; minutes: number; status: string }[];
  birthdays: { id: string; fullName: string; day: number }[];
  /** Work-from-home requests (pending or approved). */
  wfh?: { id: string; startDate: string; endDate: string; status: string; currentStep: string | null }[];
}

const LEGEND: [string, string][] = [['PRESENT', 'Satisfactory'], ['LATE', 'Late / irregular'], ['ABSENT', 'Absent'], ['ON_LEAVE', 'Leave'], ['HOLIDAY', 'Holiday']];
const shift = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const leaveStatusLabel = (l: CalendarData['leaves'][number]) => (l.status === 'CANCELLED' ? 'cancelled' : l.status === 'PENDING' ? `pending ${l.currentStep === 'HR' ? 'HR' : 'Team Lead'}` : l.status.toLowerCase());

/**
 * Month calendar: attendance, leave, holidays, company/department events and birthdays, from GET /calendar
 * (the server filters what each person may see). Used on the Calendar page and the dashboard.
 */
export function CalendarView({ employeeId = '', compact = false, headerExtra }: { employeeId?: string; compact?: boolean; headerExtra?: React.ReactNode }) {
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isLoading } = useApi<CalendarData>(`/calendar${qs({ month, employeeId })}`);

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // Monday first
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  }, [month]);

  const dayInfo = (d: string) => ({
    att: data?.attendance.find((a) => a.date === d),
    hol: data?.holidays.filter((h) => h.date === d) ?? [],
    ev: data?.events.filter((e) => e.startDate <= d && e.endDate >= d) ?? [],
    lv: data?.leaves.filter((l) => l.startDate <= d && l.endDate >= d) ?? [],
    ot: data?.overtime.find((o) => o.date === d),
    bd: data?.birthdays.filter((b) => b.day === Number(d.slice(8))) ?? [],
    wfh: data?.wfh?.filter((w) => w.startDate <= d && w.endDate >= d) ?? [],
  });
  const today = todayLocal();
  const sel = selected ? dayInfo(selected) : null;
  const cellH = compact ? 'min-h-9 sm:min-h-10' : 'min-h-24';

  return (
    <>
      <Card>
        <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b px-4', compact ? 'py-1.5' : 'py-3')}>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => setMonth((m) => shift(m, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <h2 className="w-36 text-center font-semibold sm:w-40" aria-live="polite">{monthLabel(month)}</h2>
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setMonth((m) => shift(m, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setMonth(today.slice(0, 7))}>Today</Button>
          </div>
          {headerExtra}
          <ul className="flex flex-wrap gap-3 text-xs" aria-label="Legend">
            {LEGEND.map(([k, l]) => <li key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: data?.colors[k] ?? '#999' }} aria-hidden />{l}</li>)}
          </ul>
        </div>
        {isLoading ? <Skeleton className="m-4 h-72" /> : (
          <div className="grid grid-cols-7 text-sm" role="grid" aria-label={monthLabel(month)}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} role="columnheader" className={cn('border-b px-1 text-center text-xs font-medium text-muted-foreground', compact ? 'py-1' : 'py-2')}>{d}</div>)}
            {cells.map((d, i) => {
              if (!d) return <div key={`e${i}`} className={cn(cellH, 'border-r border-b bg-muted/30')} />;
              const x = dayInfo(d);
              const color = x.att ? data?.colors[x.att.status] : x.hol.length ? data?.colors.HOLIDAY : undefined;
              return (
                <button key={d} role="gridcell" onClick={() => setSelected(d)} className={cn(cellH, 'min-w-0 border-r border-b p-1 text-left align-top transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 sm:p-1.5', d === today && 'bg-primary-soft/50')}>
                  <div className="flex items-center justify-between">
                    <span className={cn('text-xs font-medium', d === today && 'rounded-full bg-primary px-1.5 text-white')}>{Number(d.slice(8))}</span>
                    {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} title={x.att?.status ?? 'Holiday'} />}
                  </div>
                  {compact ? (
                    // Short calendar: one coloured dot per item; tap the day for details.
                    <div className="mt-1 flex flex-wrap gap-0.5" aria-hidden>
                      {x.hol.map((h) => <span key={h.id} title={h.name} className="h-1.5 w-1.5 rounded-full bg-violet-500" />)}
                      {x.lv.map((l) => <span key={l.id} title={`${l.typeName} · ${leaveStatusLabel(l)}`} className={cn('h-1.5 w-1.5 rounded-full', l.status !== 'APPROVED' && 'opacity-50')} style={{ background: l.status === 'REJECTED' ? '#94a3b8' : l.color }} />)}
                      {x.wfh.map((w) => <span key={w.id} title="Work from home" className={cn('h-1.5 w-1.5 rounded-full bg-emerald-500', w.status !== 'APPROVED' && 'opacity-50')} />)}
                      {x.ev.map((e) => <span key={e.id} title={e.title} className="h-1.5 w-1.5 rounded-full bg-sky-500" />)}
                      {x.bd.map((b) => <span key={b.id} title={`${b.fullName}'s birthday`} className="h-1.5 w-1.5 rounded-full bg-pink-500" />)}
                    </div>
                  ) : (
                  <div className="mt-1 space-y-0.5">
                    {x.hol.map((h) => <p key={h.id} className="truncate rounded bg-violet-100 px-1 text-[11px] text-violet-800 dark:bg-violet-950 dark:text-violet-200">{h.name}</p>)}
                    {x.lv.map((l) => <p key={l.id} className={cn('truncate rounded px-1 text-[11px] text-white', l.status !== 'APPROVED' && 'opacity-60', l.status === 'CANCELLED' && 'line-through')} style={{ background: l.status === 'REJECTED' ? '#94a3b8' : l.color }}>{l.typeName}{compact ? '' : ` · ${leaveStatusLabel(l)}`}</p>)}
                    {x.wfh.map((w) => <p key={w.id} className={cn('truncate rounded bg-emerald-100 px-1 text-[11px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200', w.status !== 'APPROVED' && 'opacity-60')}>WFH{compact || w.status === 'APPROVED' ? '' : ' · pending'}</p>)}
                    {x.ev.map((e) => <p key={e.id} className="truncate rounded bg-sky-100 px-1 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">{e.title}</p>)}
                    {!compact && x.ot && <p className="truncate text-[11px] text-success">+{hours(x.ot.minutes)} OT</p>}
                    {x.bd.map((b) => <p key={b.id} className="truncate text-[11px]">🎂 {b.fullName}</p>)}
                  </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </Card>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)} title={selected ? new Date(`${selected}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''} size="sm">
        {sel && (
          <CardBody className="space-y-3 p-0 text-sm">
            {sel.att ? (
              <div><p className="font-medium">Attendance: {sel.att.status.replace('_', ' ').toLowerCase()}</p><p className="text-muted-foreground">{time(sel.att.checkIn)} – {time(sel.att.checkOut)} · {hours(sel.att.workedMinutes)} worked{sel.att.lateMinutes ? ` · ${sel.att.lateMinutes}m late` : ''}{sel.att.overtimeMinutes ? ` · ${hours(sel.att.overtimeMinutes)} overtime` : ''}</p></div>
            ) : <p className="text-muted-foreground">No attendance record.</p>}
            {sel.lv.map((l) => <p key={l.id}>{l.typeName}{l.halfDay ? ' (half day)' : ''}: <strong>{leaveStatusLabel(l)}</strong></p>)}
            {sel.wfh.map((w) => <p key={w.id}>Work from home: <strong>{w.status === 'APPROVED' ? 'approved' : `pending ${w.currentStep === 'HR' ? 'HR' : 'Team Lead'}`}</strong></p>)}
            {sel.hol.map((h) => <p key={h.id}>🏖 {h.name}</p>)}
            {sel.ev.map((e) => <div key={e.id}><p className="font-medium">{e.title}</p>{e.description && <p className="text-muted-foreground">{e.description}</p>}</div>)}
            {sel.bd.map((b) => <p key={b.id}>🎂 {b.fullName}&apos;s birthday</p>)}
          </CardBody>
        )}
      </Dialog>
    </>
  );
}
