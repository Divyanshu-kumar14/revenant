import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/logout/route";
import { SESSION_COOKIE, createSession, sessionCookieHeader } from "@/auth/session";

const SECRET = "logout-test-secret-padded-to-32-chars";
const URL_ = "http://localhost/api/admin/logout";

// Next calls every route handler with the request; the handler simply does not read it.
const logout: (request: Request) => Promise<Response> = POST;

/** Every attribute except Max-Age, which must match the cookie login sets. */
function scope(header: string): string[] {
  return header
    .split(";")
    .slice(1)
    .map((part) => part.trim())
    .filter((part) => !part.startsWith("Max-Age="));
}

describe("POST /api/admin/logout", () => {
  it("clears the session cookie with the scope login sets, with or without a session", async () => {
    const requests = [
      new Request(URL_, { method: "POST" }),
      new Request(URL_, {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${createSession("admin", SECRET)}` },
      }),
    ];
    for (const request of requests) {
      const response = await logout(request);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/admin/login");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const header = response.headers.get("set-cookie") ?? "";
      expect(header.startsWith(`${SESSION_COOKIE}=;`)).toBe(true);
      expect(header).toContain("Max-Age=0");
      expect(header).toContain("Path=/");
      expect(header).toContain("SameSite=Lax");
      expect(scope(header)).toEqual(scope(sessionCookieHeader("token")));
    }
  });
});
