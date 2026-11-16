import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Per-account attempt limit (sliding window, in memory), on top of the per-IP request limits and the
 * database account lockout. Stops one email being hammered from many IP addresses.
 * With several API instances each keeps its own window; the database lockout still applies everywhere.
 */
export class AttemptLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Records an attempt for `key` and throws 429 when the limit is exceeded. */
  hit(key: string) {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      const waitMin = Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 60_000));
      throw new HttpException({ message: `Too many sign-in attempts for this account. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.`, code: 'TOO_MANY_ATTEMPTS' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 50_000) this.prune(now);
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

/** 10 attempts per email per 15 minutes for company and platform sign-in; 5 reset emails per hour. */
export const loginAttempts = new AttemptLimiter(10, 15 * 60_000);
export const resetAttempts = new AttemptLimiter(5, 60 * 60_000);
