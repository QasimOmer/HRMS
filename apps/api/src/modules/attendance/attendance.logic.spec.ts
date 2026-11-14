import { zonedInstant } from '../../common/tz';
import { computeDay, type DayInput } from './attendance.logic';

const TZ = 'Asia/Karachi';
const base = (over: Partial<DayInput> = {}): DayInput => ({
  date: '2026-11-10', // Tuesday
  tz: TZ,
  schedule: { startTime: '09:00', endTime: '18:00', breakMinutes: 60, workingDays: [1, 2, 3, 4, 5] },
  punches: [],
  isHoliday: false,
  leave: 'NONE',
  compensationHalfDay: false,
  overtimeThresholdMinutes: 30,
  isFuture: false,
  ...over,
});
const at = (t: string, date = '2026-11-10') => zonedInstant(date, t, TZ);
const p = (t: string, type?: 'IN' | 'OUT' | 'BREAK_START' | 'BREAK_END') => ({ at: at(t), type, source: 'DEVICE' as const });

describe('computeDay', () => {
  it('marks a normal day present with an untyped lunch break', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('13:00'), p('14:00'), p('18:00')] }));
    expect(r.status).toBe('PRESENT');
    expect(r.breakMinutes).toBe(60);
    expect(r.workedMinutes).toBe(480);
    expect(r.overtimeMinutes).toBe(0);
  });

  it('allows leaving early when the break was skipped (C1)', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('17:00')] }));
    expect(r.skippedBreak).toBe(true);
    expect(r.workedMinutes).toBe(480);
    expect(r.earlyLeave).toBe(false);
    expect(r.status).toBe('PRESENT');
  });

  it('flags late arrival as LATE (yellow) and stores the late minutes', () => {
    const r = computeDay(base({ punches: [p('09:40'), p('18:40')] }));
    expect(r.lateMinutes).toBe(40);
    expect(r.status).toBe('LATE');
  });

  it('has no grace period (ATT-03): shift 13:30, check-in 13:52 = 22 minutes late', () => {
    const r = computeDay(base({ schedule: { startTime: '13:30', endTime: '22:30', breakMinutes: 60, workingDays: [1, 2, 3, 4, 5] }, punches: [p('13:52'), p('22:52')] }));
    expect(r.lateMinutes).toBe(22);
    expect(r.status).toBe('LATE');
  });

  it('OVT-07: 2h of approved overtime reduces the required hours by 2h', () => {
    const r = computeDay(base({ reducedMinutes: 120, punches: [p('09:00'), p('13:00'), p('14:00'), p('16:00')] }));
    expect(r.scheduledMinutes).toBe(360);
    expect(r.workedMinutes).toBe(360);
    expect(r.earlyLeave).toBe(false);
    expect(r.status).toBe('PRESENT');
  });

  it('OVT-07: a shortened day may also start later without counting as late', () => {
    const r = computeDay(base({ reducedMinutes: 120, punches: [p('11:00'), p('12:30'), p('13:30'), p('18:00')] }));
    expect(r.lateMinutes).toBe(0);
    expect(r.status).toBe('PRESENT');
  });

  it('is on time when checking in exactly at shift start', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('18:00')] }));
    expect(r.lateMinutes).toBe(0);
    expect(r.status).toBe('PRESENT');
  });

  it('flags leaving early without enough hours', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('15:00')] }));
    expect(r.earlyLeave).toBe(true);
    expect(r.status).toBe('LATE');
  });

  it('computes overtime above the threshold', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('13:00'), p('14:00'), p('20:00')] }));
    expect(r.overtimeMinutes).toBe(120);
  });

  it('ignores overtime below the threshold', () => {
    const r = computeDay(base({ punches: [p('09:00'), p('13:00'), p('14:00'), p('18:20')] }));
    expect(r.overtimeMinutes).toBe(0);
  });

  it('marks absent on a past working day with no punches', () => {
    expect(computeDay(base()).status).toBe('ABSENT');
  });

  it('does not mark absent for today before any punch', () => {
    expect(computeDay(base({ isFuture: true })).status).toBe('PENDING');
  });

  it('marks approved leave days as ON_LEAVE (navy)', () => {
    expect(computeDay(base({ leave: 'FULL' })).status).toBe('ON_LEAVE');
  });

  it('marks weekends and holidays', () => {
    expect(computeDay(base({ date: '2026-11-08' })).status).toBe('WEEKEND');
    expect(computeDay(base({ isHoliday: true })).status).toBe('HOLIDAY');
  });

  it('counts all weekend work as overtime', () => {
    const r = computeDay(base({ date: '2026-11-08', punches: [{ at: at('10:00', '2026-11-08'), source: 'DEVICE' }, { at: at('14:00', '2026-11-08'), source: 'DEVICE' }] }));
    expect(r.overtimeMinutes).toBe(240);
  });

  it('applies approved corrections over device punches', () => {
    const r = computeDay(
      base({
        punches: [p('09:45'), { at: at('09:00'), type: 'IN', source: 'CORRECTION' }, { at: at('18:00'), type: 'OUT', source: 'CORRECTION' }],
      }),
    );
    expect(r.checkIn?.toISOString()).toBe(at('09:00').toISOString());
    expect(r.checkOut?.toISOString()).toBe(at('18:00').toISOString());
    expect(r.status).toBe('PRESENT');
  });

  it('halves required time for an approved half-day compensation', () => {
    const r = computeDay(base({ compensationHalfDay: true, punches: [p('09:00'), p('13:00')] }));
    expect(r.scheduledMinutes).toBe(240);
    expect(r.status).toBe('HALF_DAY');
    expect(r.earlyLeave).toBe(false);
  });

  it('uses explicit break punches when present', () => {
    const r = computeDay(base({ punches: [p('09:00', 'IN'), p('12:00', 'BREAK_START'), p('12:30', 'BREAK_END'), p('17:30', 'OUT')] }));
    expect(r.breakMinutes).toBe(30);
    expect(r.workedMinutes).toBe(480);
  });
});
