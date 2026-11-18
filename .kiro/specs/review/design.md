# Design — Review

## Context

`/admin/review/[id]` renders one item at a time from a server component. Mutations go through one server action, `reviewItem`, which owns the state machine and the audit write. The UI never mutates the database directly.

## Components

```
src/auth/session.ts            createSession, verifySession, requireAdmin
src/auth/gate.ts               requireAdminPage — page-side gate, redirects to /admin/login
src/review/actions.ts          reviewItem(db, decision, clock?) — accept today, the rest in task 5
src/review/state.ts            allowed transitions
src/app/admin/login/page.tsx   password form
src/app/admin/(protected)/     layout.tsx gates the group; page.tsx is ingest + queue summary
src/app/admin/review/[id]/page.tsx
src/components/review/*        image panel, field list, confidence badge, shortcuts
src/app/api/admin/review/route.ts  thin JSON wrapper for tests and future clients
```

## State machine

```
queued ──claim──> extracting ──ok──> needs_review ──accept──> published
                      │                    │  ▲                 │
                      └──error─────────────┘  └──reopen── rejected
```

- `claim` is a single `UPDATE ... WHERE status='queued' RETURNING *` inside a transaction.
- `accept` requires `status='needs_review'`; it writes `records` (upsert), sets `published_at`, sets status, writes audit, rebuilds the search row — one transaction.
- `reject` sets `rejected` and clears `published_at`; the search row is deleted in the same transaction.
- The search-row work named above lands with the archive spec, which creates `search_fts`; `reviewItem` today writes no search rows.
- `reopen` is admin-only and returns `rejected` to `needs_review` with an audit event.
- Any other transition throws `InvalidTransition`; the route maps it to `409`.
- Invariant: `records.published_at IS NOT NULL` exactly when `items.status = 'published'`. The audit table is the only place publication history survives.

## Interfaces

```ts
// src/review/state.ts
export type ReviewAction = "accept" | "edit" | "reject" | "reopen";

// src/review/actions.ts
export type ReviewFields = z.infer<typeof reviewFieldsSchema>;
// {
//   title: string | null;          // trimmed, max 500
//   description: string | null;    // trimmed, max 20_000
//   transcription: string | null;  // trimmed, max 50_000
//   dateDisplay: string | null;    // trimmed, max 200
//   dateStart: string | null;      // YYYY-MM-DD
//   dateEnd: string | null;        // YYYY-MM-DD
//   datePrecision: Precision;
//   people: ExtractedEntity[];     // max 50, extractedEntitySchema from src/extract/provider.ts
//   places: ExtractedEntity[];     // max 50
//   subjects: ExtractedEntity[];   // max 20
//   confidence: Record<string, number>; // [0, 1], default {}
// }

export interface ReviewDecision {
  itemId: string;
  action: ReviewAction;
  actor: string;
  fields?: ReviewFields;
}

export interface ReviewOutcome {
  status: ItemStatus;
}

// Synchronous: node:sqlite is synchronous. One clock instant per transaction.
export function reviewItem(db: ReviewDb, decision: ReviewDecision, clock?: () => Date): ReviewOutcome;
```

`reviewItem` validates with `zod`, checks the transition, enforces title and date display on accept, enforces `date_start <= date_end`, and writes audit before/after snapshots.

## Screen

- Two columns at ≥ 1024 px (image 55%, record 45%); stacked below, image first.
- Sticky action bar: `Accept ⏎`, `Edit E`, `Reject X`, queue position, `?`.
- Each field row: label, value, model-confidence badge. Low confidence shows the word `low` plus a dotted underline.
- Editing turns values into inputs in place; the date display stays free text and is re-normalised on save by `normalizeDate`.
- After accept: focus moves to the next item's `<h1>`, an `aria-live="polite"` region announces `"Published. 2 low-confidence fields: date, place."`, and the queue advances.
- No animation is required for comprehension; all transitions respect `prefers-reduced-motion`.

## Auth

- **Cookie.** `revenant_session` = `base64url(JSON {a, e}).base64url(HMAC-SHA256(payload, SESSION_SECRET))`, where `a` is the actor and `e` the expiry in epoch milliseconds. Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=43200` (12 h), plus `Secure` when `NODE_ENV=production`; no `Expires`, because the token carries its own expiry. The payload carries the actor because `records.reviewed_by` needs it. `requireAdmin()` reads the cookie, verifies the signature with `timingSafeEqual`, and throws `Unauthorized`. `sessionCookieHeader` and `clearSessionCookieHeader` (`src/auth/session.ts`) build both headers from one function, so setting and clearing share Path, HttpOnly and SameSite.
- **Login.** `POST /api/admin/login` takes a form field `password` and always answers `303`. Order: `SESSION_SECRET` missing or shorter than 32 characters, or `ADMIN_PASSWORD` empty, answers `500 CONFIG` (an unconfigured deploy looks broken, not locked); a body that is not a form is an empty password; the rate limit is checked before the password is compared; `passwordMatches` (`src/auth/password.ts`) SHA-256-hashes both sides and compares the 32-byte digests with `timingSafeEqual`. Success redirects to `/admin` with the cookie; a wrong password redirects to `/admin/login?error=wrong`; a throttled client redirects to `/admin/login?error=rate`. Both failure answers carry `Cache-Control: no-store` and differ only in the error token.
- **Logout.** `POST /api/admin/logout` redirects (`303`) to `/admin/login` with the cookie cleared (`Max-Age=0`). It checks no session, so an expired one can still be cleared. The control is a form in the `/admin` header.
- **Rate limit.** `src/auth/rate-limit.ts`: 5 failures per key per 15 minutes, sliding. Only failures count: the route calls `check()` before comparing and `record()` only after an allowed attempt was wrong, so a refusal never extends the window and a typo followed by success costs one attempt. The key is the first `X-Forwarded-For` entry, else `unknown`. XFF is trusted because the deploy is one container behind one proxy; exposed directly, a client picks its own key and the limit weakens to a speed bump. The map is in memory, single instance, capped at 10,000 keys (expired keys go first, then the key with the oldest latest failure).
- **Actor.** Every session's actor is the shared `"admin"`, so audit rows identify the institution's login, not a person.
- **Login page.** `src/app/admin/login/page.tsx` awaits `searchParams` to show the error, and sets `export const instant = false`: with `cacheComponents`, awaiting `searchParams` outside `<Suspense>` fails the prerender, so the route renders on demand.

## Testing

- Unit: each transition, invalid transition, missing title, inverted dates, audit snapshot contents, reject removes from `listPublished()`, reopen restores.
- Property: for any sequence of accepted decisions, `listPublished()` contains exactly the accepted ids.
- E2E: login → upload fixture → run batch → review → `Enter` → public `/items/[id]` shows the title and citation.
- Accessibility: axe on the review screen; keyboard-only path in Playwright.
