import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  Unauthorized,
  createSession,
  requireAdmin,
  verifySession,
} from "@/auth/session";

const SECRET = "unit-test-secret-padded-to-32-chars";
const T0 = Date.UTC(2026, 10, 18, 12, 0, 0);

function requestWithCookie(cookie?: string): Request {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", cookie);
  return new Request("http://localhost/api/admin/ingest", { method: "POST", headers });
}

describe("session cookie", () => {
  it("round-trips the actor and an expiry 12 hours out", () => {
    const cookie = createSession("volunteer", SECRET, T0);
    expect(verifySession(cookie, SECRET, T0)).toEqual({ actor: "volunteer", expiresAt: T0 + SESSION_TTL_MS });
    expect(SESSION_TTL_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("rejects a session at or after its expiry", () => {
    const cookie = createSession("volunteer", SECRET, T0);
    expect(verifySession(cookie, SECRET, T0 + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifySession(cookie, SECRET, T0 + SESSION_TTL_MS)).toBeNull();
  });

  it("rejects a cookie signed with a different secret", () => {
    const cookie = createSession("volunteer", "other-secret-also-padded-to-32-chars", T0);
    expect(verifySession(cookie, SECRET, T0)).toBeNull();
  });

  it("rejects a tampered payload or signature", () => {
    const cookie = createSession("volunteer", SECRET, T0);
    const [payload = "", signature = ""] = cookie.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ a: "volunteer", e: T0 + 10 * SESSION_TTL_MS })).toString(
      "base64url",
    );
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(verifySession(`${forgedPayload}.${signature}`, SECRET, T0)).toBeNull();
    expect(verifySession(`${payload}.${flipped}`, SECRET, T0)).toBeNull();
  });

  it("rejects malformed values without throwing", () => {
    for (const value of ["", ".", "abc", "a.b.c", "!!!.???", `${Buffer.from("not json").toString("base64url")}.x`]) {
      expect(verifySession(value, SECRET, T0)).toBeNull();
    }
  });

  it("refuses to sign or verify with an empty secret", () => {
    expect(() => createSession("volunteer", "", T0)).toThrow();
    expect(() => verifySession("a.b", "", T0)).toThrow();
  });

  it("refuses to sign with a secret shorter than 32 characters", () => {
    expect(() => createSession("volunteer", "x".repeat(31), T0)).toThrow(
      "Session secret must be at least 32 characters.",
    );
  });
});

describe("requireAdmin", () => {
  it("returns the session when the cookie is valid among other cookies", () => {
    const cookie = createSession("margaret", SECRET, T0);
    const request = requestWithCookie(`theme=dark; ${SESSION_COOKIE}=${cookie}; other=1`);
    expect(requireAdmin(request, SECRET, T0).actor).toBe("margaret");
  });

  it("throws Unauthorized when the cookie is missing, malformed or expired", () => {
    const expired = createSession("volunteer", SECRET, T0 - SESSION_TTL_MS);
    for (const request of [
      requestWithCookie(),
      requestWithCookie("theme=dark"),
      requestWithCookie(`${SESSION_COOKIE}=garbage`),
      requestWithCookie(`${SESSION_COOKIE}=${expired}`),
    ]) {
      expect(() => requireAdmin(request, SECRET, T0)).toThrow(Unauthorized);
    }
  });
});
