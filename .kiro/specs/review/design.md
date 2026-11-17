# Design — Review

## Context

`/admin/review/[id]` renders one item at a time from a server component. Mutations go through one server action, `reviewItem`, which owns the state machine and the audit write. The UI never mutates the database directly.

## Components

```
src/auth/session.ts            createSession, verifySession, requireAdmin
src/review/actions.ts          reviewItem(decision) — the only mutation entry point
src/review/state.ts            allowed transitions
src/app/admin/login/page.tsx   password form
src/app/admin/page.tsx         ingest + queue summary
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
- `reopen` is admin-only and returns `rejected` to `needs_review` with an audit event.
- Any other transition throws `InvalidTransition`; the route maps it to `409`.

## Interfaces

```ts
export type ReviewAction = "accept" | "edit" | "reject" | "reopen";

export interface ReviewDecision {
  itemId: string;
  action: ReviewAction;
  actor: string;
  fields?: {
    title: string;
    description: string | null;
    transcription: string | null;
    dateDisplay: string;
    dateStart: string | null;
    dateEnd: string | null;
    datePrecision: Precision;
    people: ExtractedEntity[];
    places: ExtractedEntity[];
    subjects: ExtractedEntity[];
  };
}

export async function reviewItem(decision: ReviewDecision): Promise<ReviewOutcome>;
// ReviewOutcome = { status: ItemStatus; lowConfidenceFields: string[] }
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

Cookie `rvn_session` = `<expiresAt>.<hmacSHA256(expiresAt, SESSION_SECRET)>`, `httpOnly`, `sameSite=lax`, `path=/`, 12 h. `requireAdmin()` reads the cookie, verifies with `timingSafeEqual`, and throws `Unauthorized`. Login compares `ADMIN_PASSWORD` with `timingSafeEqual` against a fixed-length digest. The in-memory rate limiter is explicitly single-instance; the deploy is one container, and it is documented rather than pretended away.

## Testing

- Unit: each transition, invalid transition, missing title, inverted dates, audit snapshot contents, reject removes from `listPublished()`, reopen restores.
- Property: for any sequence of accepted decisions, `listPublished()` contains exactly the accepted ids.
- E2E: login → upload fixture → run batch → review → `Enter` → public `/items/[id]` shows the title and citation.
- Accessibility: axe on the review screen; keyboard-only path in Playwright.
