import { lockMinutesFor } from './lockout';

describe('SEC-04 login lockout', () => {
  it('does not lock before 5 failed attempts', () => {
    expect([0, 1, 4].map(lockMinutesFor)).toEqual([0, 0, 0]);
  });

  it('locks for 15 minutes at 5 failures and doubles on every further failure', () => {
    expect([5, 6, 7, 8].map(lockMinutesFor)).toEqual([15, 30, 60, 120]);
  });

  it('caps the lock at 24 hours', () => {
    expect(lockMinutesFor(20)).toBe(24 * 60);
  });
});
