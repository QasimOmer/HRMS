/** SEC-04: account lockout after repeated failed logins. */
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MAX_LOCK_MINUTES = 24 * 60;

/**
 * SEC-04: 5 failed attempts lock the account for 15 minutes; every further failed attempt
 * doubles the lock (30, 60, 120 … minutes, capped at 24 hours). A successful login resets it.
 */
export function lockMinutesFor(failedAttempts: number): number {
  if (failedAttempts < MAX_FAILED) return 0;
  return Math.min(MAX_LOCK_MINUTES, LOCK_MINUTES * 2 ** (failedAttempts - MAX_FAILED));
}

export const waitText = (until: Date) => {
  const m = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} minute${m === 1 ? '' : 's'}`;
};
