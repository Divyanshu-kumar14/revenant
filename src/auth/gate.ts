import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { MIN_SECRET_LENGTH, SESSION_COOKIE, verifySession, type Session } from "./session";

/**
 * Page-side counterpart of `requireAdmin`: read the session cookie through `next/headers` and
 * redirect to `/admin/login` when it is missing, tampered or expired. Kept out of `session.ts`
 * so that module stays framework-free for unit tests and route handlers.
 *
 * Never wrap a call in try/catch: `redirect()` throws `NEXT_REDIRECT`, and catching it turns the
 * redirect into a 500.
 */
export async function requireAdminPage(): Promise<Session> {
  // Defer to request time. Without it the build prerenders this with no SESSION_SECRET (and
  // throws), and dev flags verifySession's Date.now() even after cookies() has been read.
  await connection();
  const secret = process.env.SESSION_SECRET;
  // A misconfigured deploy must look broken, not signed out. Name the variable, never its value.
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set and at least ${MIN_SECRET_LENGTH} characters.`);
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token === undefined ? null : verifySession(token, secret);
  if (!session) redirect("/admin/login");
  return session;
}
