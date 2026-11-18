import { z } from "zod";
import { passwordMatches } from "@/auth/password";
import { clientKey, loginLimiter } from "@/auth/rate-limit";
import { MIN_SECRET_LENGTH, createSession, sessionCookieHeader } from "@/auth/session";

/**
 * One shared password, so every session's actor is the institution's shared login. Audit rows
 * name this login, not a person.
 */
const ACTOR = "admin";

const formSchema = z.object({ password: z.string() });

type ErrorBody = { status: "error"; error: { code: "CONFIG"; message: string } };

/**
 * Form POST from /admin/login. Answers 303 so the browser follows with a GET: to /admin with a
 * session cookie on success, back to /admin/login with an error token otherwise.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("login route: CONFIG SESSION_SECRET is not set");
    return configError();
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`login route: CONFIG SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
    return configError();
  }
  // An unconfigured deploy must look broken, not locked.
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error("login route: CONFIG ADMIN_PASSWORD is not set");
    return configError();
  }

  const password = await readPassword(request);

  // Checked before comparing: a throttled client costs no hashing and learns nothing.
  const key = clientKey(request);
  const now = Date.now();
  if (!loginLimiter.check(key, now).allowed) return redirect("/admin/login?error=rate");

  if (!passwordMatches(password, adminPassword)) {
    loginLimiter.record(key, now);
    return redirect("/admin/login?error=wrong");
  }

  const token = createSession(ACTOR, secret);
  return redirect(
    "/admin",
    sessionCookieHeader(token, { secure: process.env.NODE_ENV === "production" }),
  );
}

/** A body that is not a form, or a form without a password, is an empty password. */
async function readPassword(request: Request): Promise<string> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Not a form body: treat it as a wrong password rather than a server error.
    return "";
  }
  const parsed = formSchema.safeParse({ password: form.get("password") });
  return parsed.success ? parsed.data.password : "";
}

/** Wrong-password and rate-limited answers share this, so they differ only in the location. */
function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (setCookie !== undefined) headers.set("Set-Cookie", setCookie);
  return new Response(null, { status: 303, headers });
}

function configError(): Response {
  const body: ErrorBody = {
    status: "error",
    error: { code: "CONFIG", message: "The server is not configured for admin sign-in." },
  };
  return Response.json(body, { status: 500 });
}
