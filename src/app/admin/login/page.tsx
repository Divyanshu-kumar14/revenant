import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

// cacheComponents forbids awaiting searchParams outside <Suspense> at prerender; render per request.
export const instant = false;

/** Only known tokens produce text; any other value renders nothing and is never echoed. */
function errorMessage(error: string | undefined): string | null {
  switch (error) {
    case "wrong":
      return "That password was not accepted.";
    case "rate":
      return "Too many attempts. Wait fifteen minutes and try again.";
    default:
      return null;
  }
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = errorMessage(error);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-baseline gap-3 px-6 py-5">
          <Link href="/" className="font-display text-xl tracking-tight text-paper hover:text-lamp">
            Revenant
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
            admin
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-paper">Sign in</h1>
        <p className="mt-5 max-w-2xl leading-relaxed text-paper-dim">
          Enter the password your institution uses for the archive.
        </p>
        <form method="post" action="/api/admin/login" className="mt-10 flex max-w-sm flex-col gap-3">
          <label
            htmlFor="password"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim"
          >
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? "login-error" : undefined}
            className="border border-line bg-ink-raised px-3 py-2 text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
          />
          {message ? (
            <p id="login-error" role="alert" className="text-sm text-oxblood-text">
              {message}
            </p>
          ) : null}
          <button
            type="submit"
            className="mt-3 self-start cursor-pointer border border-lamp/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-lamp hover:border-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
          >
            Sign in
          </button>
        </form>
      </main>
    </div>
  );
}
