import { z } from 'zod';

/**
 * Sign in / break / sign out from the app ("punch clock"). Typed punches from the app (IN, BREAK_START,
 * BREAK_END, OUT) decide the state; an untyped punch (biometric device) counts as being signed in.
 */
export const CLOCK_ACTIONS = ['IN', 'BREAK_START', 'BREAK_END', 'OUT'] as const;
export type ClockAction = (typeof CLOCK_ACTIONS)[number];

export const clockPunchSchema = z.object({
  type: z.enum(CLOCK_ACTIONS),
  /** Signing in from home: marks the day as work from home (asks for approval if it isn't approved yet). */
  workFromHome: z.boolean().optional(),
});
export type ClockPunchInput = z.infer<typeof clockPunchSchema>;

/** NOT_STARTED: no punch today · WORKING · ON_BREAK · SIGNED_OUT. */
export type ClockState = 'NOT_STARTED' | 'WORKING' | 'ON_BREAK' | 'SIGNED_OUT';

export interface ClockPunch {
  type: string | null;
  at: Date | string;
}

export interface ClockStatus {
  state: ClockState;
  signedInAt: string | null;
  signedOutAt: string | null;
  /** Break taken so far today, including a break still running. */
  breakMinutes: number;
  onBreakSince: string | null;
}

/** Which buttons make sense in each state. */
export const CLOCK_ALLOWED: Record<ClockState, ClockAction[]> = {
  NOT_STARTED: ['IN'],
  WORKING: ['BREAK_START', 'OUT'],
  ON_BREAK: ['BREAK_END'],
  SIGNED_OUT: ['IN'],
};

/** Works out the punch-clock state from today's punches (any order). */
export function clockStatus(punches: ClockPunch[], now: Date = new Date()): ClockStatus {
  const sorted = [...punches].map((p) => ({ type: p.type, at: new Date(p.at) })).sort((a, b) => a.at.getTime() - b.at.getTime());
  if (!sorted.length) return { state: 'NOT_STARTED', signedInAt: null, signedOutAt: null, breakMinutes: 0, onBreakSince: null };
  let breakMs = 0;
  let breakStart: Date | null = null;
  for (const p of sorted) {
    if (p.type === 'BREAK_START') breakStart = breakStart ?? p.at;
    else if (p.type === 'BREAK_END' && breakStart) {
      breakMs += p.at.getTime() - breakStart.getTime();
      breakStart = null;
    }
  }
  const last = sorted[sorted.length - 1]!;
  const state: ClockState = last.type === 'OUT' ? 'SIGNED_OUT' : last.type === 'BREAK_START' ? 'ON_BREAK' : 'WORKING';
  if (state === 'ON_BREAK' && breakStart) breakMs += Math.max(0, now.getTime() - breakStart.getTime());
  const firstIn = sorted.find((p) => p.type === 'IN' || p.type === null) ?? sorted[0]!;
  return {
    state,
    signedInAt: firstIn.at.toISOString(),
    signedOutAt: state === 'SIGNED_OUT' ? last.at.toISOString() : null,
    breakMinutes: Math.round(breakMs / 60_000),
    onBreakSince: state === 'ON_BREAK' && breakStart ? breakStart.toISOString() : null,
  };
}
