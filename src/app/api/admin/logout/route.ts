import { clearSessionCookieHeader } from "@/auth/session";

/**
 * Form POST from the admin header. No auth check: clearing a cookie is harmless, and a visitor
 * whose session has expired must still be able to clear it.
 */
export async function POST(): Promise<Response> {
  const headers = new Headers({
    Location: "/admin/login",
    "Cache-Control": "no-store",
    "Set-Cookie": clearSessionCookieHeader({ secure: process.env.NODE_ENV === "production" }),
  });
  return new Response(null, { status: 303, headers });
}
