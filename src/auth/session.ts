import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed admin session cookie: `<base64url(JSON payload)>.<base64url(HMAC-SHA256(payload))>`.
 *
 * This is the smallest gate the admin routes need. Login, logout, cookie attributes and
 * rate limiting belong to review Task 1, which reuses this module.
 */

export const SESSION_COOKIE = "revenant_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A shorter HMAC key is guessable offline from one captured cookie. */
export const MIN_SECRET_LENGTH = 32;

export interface Session {
  actor: string;
  /** Epoch milliseconds; the session is invalid at and after this instant. */
  expiresAt: number;
}

export class Unauthorized extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "Unauthorized";
  }
}

/** Sign a session for `actor` that expires 12 hours after `now`. */
export function createSession(actor: string, secret: string, now: number = Date.now()): string {
  assertSecret(secret);
  const payload = Buffer.from(JSON.stringify({ a: actor, e: now + SESSION_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

/** Return the session if the signature matches and it has not expired; otherwise null. */
export function verifySession(cookie: string, secret: string, now: number = Date.now()): Session | null {
  assertSecret(secret);
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [payload = "", signature = ""] = parts;
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const session = parsePayload(payload);
  if (!session || now >= session.expiresAt) return null;
  return session;
}

/** Throw Unauthorized unless the request carries a valid session cookie. */
export function requireAdmin(request: Request, secret: string, now: number = Date.now()): Session {
  const cookie = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const session = cookie === null ? null : verifySession(cookie, secret, now);
  if (!session) throw new Unauthorized();
  return session;
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** A weak secret would make signatures forgeable; fail loudly instead of allowing. */
function assertSecret(secret: string): void {
  if (!secret) throw new Error("Session secret is empty.");
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Session secret must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
}

function parsePayload(payload: string): Session | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null) return null;
    const { a, e } = value as Record<string, unknown>;
    if (typeof a !== "string" || a === "" || typeof e !== "number" || !Number.isFinite(e)) return null;
    return { actor: a, expiresAt: e };
  } catch {
    // A payload that is not JSON is a malformed cookie, which is the same as no session.
    return null;
  }
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}
