import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/login/route";
import { loginLimiter } from "@/auth/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_MS, verifySession } from "@/auth/session";

const SECRET = "login-test-secret-padded-to-32-chars";
const PASSWORD = "correct-horse-battery";
const URL_ = "http://localhost/api/admin/login";

const originalSecret = process.env.SESSION_SECRET;
const originalPassword = process.env.ADMIN_PASSWORD;

function restore(name: "SESSION_SECRET" | "ADMIN_PASSWORD", value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.ADMIN_PASSWORD = PASSWORD;
  loginLimiter.reset();
});

afterEach(() => {
  restore("SESSION_SECRET", originalSecret);
  restore("ADMIN_PASSWORD", originalPassword);
  vi.unstubAllEnvs();
  loginLimiter.reset();
});

function login(password: string, forwardedFor?: string): Promise<Response> {
  const headers = new Headers();
  if (forwardedFor !== undefined) headers.set("x-forwarded-for", forwardedFor);
  return POST(new Request(URL_, { method: "POST", headers, body: new URLSearchParams({ password }) }));
}

function cookieAttributes(header: string): string[] {
  return header.split(";").slice(1).map((part) => part.trim());
}

describe("POST /api/admin/login", () => {
  it("redirects a wrong password back to the form without a cookie", async () => {
    const response = await login("not-the-password");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/login?error=wrong");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("signs in the shared admin with a 12-hour httpOnly SameSite=Lax cookie", async () => {
    const before = Date.now();
    const response = await login(PASSWORD);
    const after = Date.now();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const header = response.headers.get("set-cookie") ?? "";
    const [pair = ""] = header.split(";");
    expect(pair.startsWith(`${SESSION_COOKIE}=`)).toBe(true);

    const session = verifySession(pair.slice(SESSION_COOKIE.length + 1), SECRET);
    expect(session?.actor).toBe("admin");
    expect(session?.expiresAt).toBeGreaterThanOrEqual(before + SESSION_TTL_MS);
    expect(session?.expiresAt).toBeLessThanOrEqual(after + SESSION_TTL_MS);

    const attributes = cookieAttributes(header);
    expect(attributes).toEqual(expect.arrayContaining(["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=43200"]));
    expect(attributes).not.toContain("Secure");
  });

  it("marks the cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await login(PASSWORD);
    expect(cookieAttributes(response.headers.get("set-cookie") ?? "")).toContain("Secure");
  });

  it("checks the limit before the password, so the sixth attempt is refused even when correct", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await login("wrong", "203.0.113.5")).headers.get("location")).toBe("/admin/login?error=wrong");
    }
    const response = await login(PASSWORD, "203.0.113.5");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/login?error=rate");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("counts failures per client, so another address is still allowed", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await login("wrong", "203.0.113.5");
    const response = await login("wrong", "198.51.100.7");
    expect(response.headers.get("location")).toBe("/admin/login?error=wrong");
  });

  it("answers 500 CONFIG without a cookie when the secret or password is not configured", async () => {
    const cases: Array<{ secret?: string; password?: string }> = [
      { password: PASSWORD },
      { secret: "x".repeat(31), password: PASSWORD },
      { secret: SECRET },
    ];
    for (const { secret, password } of cases) {
      try {
        restore("SESSION_SECRET", secret);
        restore("ADMIN_PASSWORD", password);
        const response = await login(PASSWORD);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ status: "error", error: { code: "CONFIG" } });
        expect(response.headers.get("set-cookie")).toBeNull();
      } finally {
        process.env.SESSION_SECRET = SECRET;
        process.env.ADMIN_PASSWORD = PASSWORD;
      }
    }
  });

  it("treats a body that is not a form as a wrong password", async () => {
    const response = await POST(
      new Request(URL_, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/login?error=wrong");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
