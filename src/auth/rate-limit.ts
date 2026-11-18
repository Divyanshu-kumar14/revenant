/**
 * In-memory limiter for failed admin logins. Single instance by design: the deploy is one
 * container, so one process sees every login. A second instance would get its own budget.
 *
 * Only failures count. The route calls `check()` before comparing the password and `record()`
 * only after an allowed attempt was wrong, so a refusal never extends the window and a
 * volunteer who mistypes twice and then succeeds keeps the rest of the budget.
 */

export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimitCheck {
  allowed: boolean;
  /** Whole seconds until the oldest failure leaves the window; 0 when allowed. */
  retryAfterSeconds: number;
}

export class LoginRateLimiter {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  /** Failure timestamps per key, oldest first. */
  private readonly failures = new Map<string, number[]>();

  constructor(options: { maxAttempts?: number; windowMs?: number; maxKeys?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? LOGIN_MAX_ATTEMPTS;
    this.windowMs = options.windowMs ?? LOGIN_WINDOW_MS;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Whether `key` may attempt a login at `now`. Records nothing. */
  check(key: string, now: number): RateLimitCheck {
    const stamps = this.prune(key, now);
    const oldest = stamps[0];
    if (stamps.length < this.maxAttempts || oldest === undefined) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + this.windowMs - now) / 1000) };
  }

  /** Count one failed attempt. Call only after `check()` allowed it and the password was wrong. */
  record(key: string, now: number): void {
    const stamps = this.prune(key, now);
    if (stamps.length === 0 && this.failures.size >= this.maxKeys) this.evict(now);
    stamps.push(now);
    this.failures.set(key, stamps);
  }

  reset(): void {
    this.failures.clear();
  }

  get size(): number {
    return this.failures.size;
  }

  /** Drop stamps that have left the window; forget the key when none remain. */
  private prune(key: string, now: number): number[] {
    const stamps = this.failures.get(key);
    if (!stamps) return [];
    const live = stamps.filter((stamp) => !this.expired(stamp, now));
    if (live.length === 0) this.failures.delete(key);
    else this.failures.set(key, live);
    return live;
  }

  /**
   * The login route is unauthenticated, so a client spraying X-Forwarded-For values must not
   * grow the map without bound. Drop keys whose failures have all expired; if the map is still
   * full, drop the key whose latest failure is oldest.
   */
  private evict(now: number): void {
    let stalest: { key: string; newest: number } | null = null;
    for (const [key, stamps] of this.failures) {
      const newest = stamps[stamps.length - 1];
      if (newest === undefined || this.expired(newest, now)) {
        this.failures.delete(key);
        continue;
      }
      if (stalest === null || newest < stalest.newest) stalest = { key, newest };
    }
    if (this.failures.size >= this.maxKeys && stalest !== null) this.failures.delete(stalest.key);
  }

  private expired(stamp: number, now: number): boolean {
    return stamp + this.windowMs <= now;
  }
}

/** The process-wide limiter the login route uses. */
export const loginLimiter = new LoginRateLimiter();

/**
 * The limiter key for a request: the first X-Forwarded-For entry, else "unknown".
 *
 * This trusts X-Forwarded-For because the deploy is one container behind one proxy, which
 * overwrites the header with the client address. Without that proxy a client chooses its own
 * value, so it chooses its own bucket and the limit degrades to a speed bump.
 */
export function clientKey(request: Request): string {
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : "unknown";
}
