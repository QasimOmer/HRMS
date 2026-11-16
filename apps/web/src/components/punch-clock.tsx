'use client';

import type { ClockAction, ClockState } from '@hrms/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Coffee, House, LogIn, LogOut, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, time } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Clock {
  state: ClockState;
  signedInAt: string | null;
  signedOutAt: string | null;
  breakMinutes: number;
  onBreakSince: string | null;
  allowed: ClockAction[];
  source: string | null;
  workFromHome: { status: string; currentStep: string | null } | null;
}

const SUCCESS: Record<ClockAction, string> = {
  IN: 'Signed in',
  BREAK_START: 'Break started. Enjoy it!',
  BREAK_END: 'Welcome back, break ended',
  OUT: 'Signed out. See you tomorrow!',
};
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** Accessible on/off switch. */
function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-sm select-none', disabled && 'cursor-not-allowed opacity-60')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none', checked ? 'bg-primary' : 'bg-muted-foreground/30')}
      >
        <span className={cn('absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
      {label}
    </label>
  );
}

/**
 * Sign in (optionally from home), take / end a break and sign out from the app. Used on the dashboard and the
 * Attendance page. Each press is recorded as an attendance punch; signing in from home without approval sends
 * a work-from-home request for today to the Team Lead → HR.
 */
export function PunchClock({ className }: { className?: string }) {
  const { me, hasModule } = useAuth();
  const qc = useQueryClient();
  const enabled = !!me?.employee && hasModule('ATTENDANCE');
  const { data } = useApi<Clock>(enabled ? '/attendance/me/clock' : null, { refetchInterval: 60_000, fresh: true });
  const [wfh, setWfh] = useState(false);
  const [busy, setBusy] = useState<ClockAction | null>(null);
  const [, tick] = useState(0);
  // Keep the running break time current.
  useEffect(() => {
    if (data?.state !== 'ON_BREAK') return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [data?.state]);
  useEffect(() => {
    if (data?.workFromHome?.status === 'APPROVED') setWfh(true);
  }, [data?.workFromHome?.status]);

  if (!enabled || !data) return null;

  const act = async (type: ClockAction) => {
    setBusy(type);
    try {
      const r = await api.post<Clock>('/attendance/me/clock', { type, ...(type === 'IN' ? { workFromHome: wfh } : {}) });
      toast.success(type === 'IN' && wfh && r.workFromHome?.status === 'PENDING' ? 'Signed in from home. Your work-from-home request was sent for approval.' : SUCCESS[type]);
      qc.invalidateQueries({ predicate: (q) => ['/attendance', '/dashboard', '/leave', '/calendar'].some((p) => String(q.queryKey[0]).startsWith(p)) });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const breakNow = data.breakMinutes;
  const wfhNote = data.workFromHome
    ? data.workFromHome.status === 'APPROVED' ? 'Work from home approved for today' : `Work from home waiting for ${data.workFromHome.currentStep === 'HR' ? 'HR' : 'your Team Lead'}`
    : null;

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      {(data.state === 'NOT_STARTED' || data.state === 'SIGNED_OUT') && (
        <>
          <Switch checked={wfh} onChange={setWfh} label="Work from home" disabled={data.workFromHome?.status === 'APPROVED'} />
          <Button onClick={() => void act('IN')} loading={busy === 'IN'}>
            {wfh ? <House className="h-4 w-4" /> : <LogIn className="h-4 w-4" />} {data.state === 'SIGNED_OUT' ? 'Sign in again' : 'Sign in'}
          </Button>
          {data.state === 'SIGNED_OUT' && data.signedOutAt && <span className="text-xs text-muted-foreground">Signed out at {time(data.signedOutAt)}</span>}
        </>
      )}
      {data.state === 'WORKING' && (
        <>
          <Button variant="outline" onClick={() => void act('BREAK_START')} loading={busy === 'BREAK_START'}><Coffee className="h-4 w-4" /> Take break</Button>
          <Button variant="outline" className="text-danger" onClick={() => void act('OUT')} loading={busy === 'OUT'}><LogOut className="h-4 w-4" /> Sign out</Button>
          {breakNow > 0 && <span className="text-xs text-muted-foreground">{mins(breakNow)} break taken</span>}
        </>
      )}
      {data.state === 'ON_BREAK' && (
        <>
          <Button onClick={() => void act('BREAK_END')} loading={busy === 'BREAK_END'}><Play className="h-4 w-4" /> End break</Button>
          {data.onBreakSince && <span className="text-sm text-warning">On break since {time(data.onBreakSince)} · {mins(Math.max(0, Math.round((Date.now() - new Date(data.onBreakSince).getTime()) / 60_000)))}</span>}
        </>
      )}
      {wfhNote && <span className={cn('text-xs', data.workFromHome?.status === 'APPROVED' ? 'text-success' : 'text-warning')}>{wfhNote}</span>}
    </div>
  );
}
