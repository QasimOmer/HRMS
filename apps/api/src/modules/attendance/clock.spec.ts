import { CLOCK_ALLOWED, clockPunchSchema, clockStatus } from '@hrms/shared';

const at = (hhmm: string) => new Date(`2026-11-16T${hhmm}:00Z`);

describe('punch clock (sign in / break / sign out from the app)', () => {
  it('starts not signed in, offering only Sign in', () => {
    const s = clockStatus([]);
    expect(s.state).toBe('NOT_STARTED');
    expect(CLOCK_ALLOWED[s.state]).toEqual(['IN']);
  });

  it('after signing in offers Take break and Sign out', () => {
    const s = clockStatus([{ type: 'IN', at: at('09:00') }]);
    expect(s.state).toBe('WORKING');
    expect(s.signedInAt).toBe(at('09:00').toISOString());
    expect(CLOCK_ALLOWED[s.state]).toEqual(['BREAK_START', 'OUT']);
  });

  it('on a break offers only End break and counts the running break', () => {
    const s = clockStatus([{ type: 'IN', at: at('09:00') }, { type: 'BREAK_START', at: at('13:00') }], at('13:20'));
    expect(s.state).toBe('ON_BREAK');
    expect(s.onBreakSince).toBe(at('13:00').toISOString());
    expect(s.breakMinutes).toBe(20);
    expect(CLOCK_ALLOWED[s.state]).toEqual(['BREAK_END']);
  });

  it('adds up several breaks and ends signed out', () => {
    const s = clockStatus([
      { type: 'OUT', at: at('18:00') }, // order doesn't matter
      { type: 'IN', at: at('09:00') },
      { type: 'BREAK_START', at: at('11:00') },
      { type: 'BREAK_END', at: at('11:15') },
      { type: 'BREAK_START', at: at('13:00') },
      { type: 'BREAK_END', at: at('13:30') },
    ]);
    expect(s.state).toBe('SIGNED_OUT');
    expect(s.breakMinutes).toBe(45);
    expect(s.signedOutAt).toBe(at('18:00').toISOString());
    expect(CLOCK_ALLOWED[s.state]).toEqual(['IN']);
  });

  it('a biometric (untyped) punch counts as signed in', () => {
    const s = clockStatus([{ type: null, at: at('08:55') }]);
    expect(s.state).toBe('WORKING');
    expect(s.signedInAt).toBe(at('08:55').toISOString());
  });

  it('only accepts the four actions', () => {
    expect(clockPunchSchema.safeParse({ type: 'IN', workFromHome: true }).success).toBe(true);
    expect(clockPunchSchema.safeParse({ type: 'LUNCH' }).success).toBe(false);
  });
});
