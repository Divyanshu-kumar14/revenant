import { describe, expect, it } from "vitest";
import { LOGIN_WINDOW_MS, LoginRateLimiter, clientKey } from "@/auth/rate-limit";

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);
const SECOND = 1000;

/** Five allowed-then-wrong attempts at `now`, the way the login route records them. */
function failFiveTimes(limiter: LoginRateLimiter, key: string, now: number): void {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect(limiter.check(key, now).allowed).toBe(true);
    limiter.record(key, now);
  }
}

describe("LoginRateLimiter", () => {
  it("allows five failures and refuses the sixth attempt for the full window", () => {
    const limiter = new LoginRateLimiter();
    failFiveTimes(limiter, "203.0.113.5", T0);
    expect(limiter.check("203.0.113.5", T0)).toEqual({ allowed: false, retryAfterSeconds: 900 });
  });

  it("does not count a refused check, so the window ends 15 minutes after the first failure", () => {
    const limiter = new LoginRateLimiter();
    failFiveTimes(limiter, "203.0.113.5", T0);
    for (const minute of [1, 5, 10, 14]) {
      expect(limiter.check("203.0.113.5", T0 + minute * 60 * SECOND).allowed).toBe(false);
    }
    expect(limiter.check("203.0.113.5", T0 + LOGIN_WINDOW_MS - SECOND)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.check("203.0.113.5", T0 + LOGIN_WINDOW_MS)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("keeps keys independent", () => {
    const limiter = new LoginRateLimiter();
    failFiveTimes(limiter, "203.0.113.5", T0);
    expect(limiter.check("198.51.100.7", T0)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("drops expired keys and never holds more than maxKeys", () => {
    // One failure blocks, so a refused check shows the key is still held.
    const small = new LoginRateLimiter({ maxAttempts: 1, maxKeys: 3 });
    const later = T0 + LOGIN_WINDOW_MS;
    small.record("a", T0);
    small.record("b", T0);
    expect(small.size).toBe(2);
    small.check("a", later);
    expect(small.size).toBe(1);
    small.record("c", later);
    small.record("d", later);
    // At the cap, the expired "b" goes before any live key.
    small.record("e", later);
    expect(small.size).toBe(3);
    for (const key of ["c", "d", "e"]) expect(small.check(key, later).allowed).toBe(false);

    const limiter = new LoginRateLimiter();
    for (let index = 0; index <= 10_000; index += 1) limiter.record(`10.0.${index}`, T0 + index);
    expect(limiter.size).toBe(10_000);
  });

  it("evicts the key whose latest failure is oldest when every key is live", () => {
    const limiter = new LoginRateLimiter({ maxAttempts: 1, maxKeys: 2 });
    limiter.record("a", T0);
    limiter.record("b", T0 + 1);
    limiter.record("a", T0 + 2);
    limiter.record("c", T0 + 3);
    expect(limiter.size).toBe(2);
    expect(limiter.check("b", T0 + 4).allowed).toBe(true);
    expect(limiter.check("a", T0 + 4).allowed).toBe(false);
    expect(limiter.check("c", T0 + 4).allowed).toBe(false);
  });
});

describe("clientKey", () => {
  function request(forwardedFor?: string): Request {
    const headers = new Headers();
    if (forwardedFor !== undefined) headers.set("x-forwarded-for", forwardedFor);
    return new Request("http://localhost/api/admin/login", { method: "POST", headers });
  }

  it("takes the first X-Forwarded-For entry, trimmed, or 'unknown' without one", () => {
    expect(clientKey(request(" 203.0.113.5 , 10.0.0.1, 10.0.0.2"))).toBe("203.0.113.5");
    expect(clientKey(request("198.51.100.7"))).toBe("198.51.100.7");
    expect(clientKey(request())).toBe("unknown");
    expect(clientKey(request(""))).toBe("unknown");
  });
});
