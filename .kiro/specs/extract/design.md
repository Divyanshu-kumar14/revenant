# Design — Extract

## Context

An item leaves ingest as `queued` with a normalised JPEG at `uploads/<sha256>.jpg`. Extraction claims it, sends the image to the vision model behind the `Extractor` interface, stores what came back with its provenance, and moves the item to `needs_review`. Two entry points start it: `pnpm extract` and `POST /api/admin/extract`. Both call the same use case in `src/extract/extract-item.ts`. Nothing starts extraction on upload, and no process runs in the background.

The provider adapters, the prompt and the error codes already exist from the accuracy spike: `Extractor`, `ExtractionError`, `ExtractionErrorCode`, `extractionSchema` and `PRECISIONS` in `src/extract/provider.ts`, `NimExtractor` in `src/extract/nim.ts`, and `EXTRACTION_PROMPT` with `PROMPT_VERSION = "v1"` in `src/extract/prompt.ts`. This spec uses them; it does not redesign them.

The evidence base is ADR 0001: one NIM base run of 20 items plus five single-item reruns, assembled from seven `eval-runs/spike-20261117T*.json` files, giving the promise "catalogue with mandatory review". That result covers those 20 items, model `nvidia/nemotron-3.5-super-vl-120b-a12b` and prompt `v1`. Nothing in this spec claims more.

## Components

```
src/extract/date.ts                 normalizeDate(): archive conventions §1
src/extract/names.ts                displayName(), nameKey(): archive conventions §2
src/extract/extract-item.ts         claim, extract, finish; deriveProposal(); runBatch(); createExtractor()
src/extract/provider.ts             Extractor, ExtractionError, extractionSchema, GeminiExtractor (exists)
src/extract/nim.ts                  NimExtractor (exists)
src/extract/prompt.ts               EXTRACTION_PROMPT, PROMPT_VERSION (exists)
scripts/extract.ts                  pnpm extract: argument parsing, one line per item, summary, exit code
src/app/api/admin/extract/route.ts  session gate, body validation, bounded runBatch(), counts
src/db/schema.sql, src/db/client.ts extractions.prompt_version and its guarded ALTER
```

`src/extract/**` stays the only place that knows a provider exists; the route and the script call `createExtractor()` and never name an adapter. `date.ts` and `names.ts` are pure and import nothing outside the standard library, so review can reuse `normalizeDate` when it re-normalises an edited date.

`scripts/extract.ts` runs under plain `node`, which resolves neither the `@/` alias nor extensionless relative imports. Every module in its import graph uses relative specifiers with an explicit `.ts`, as `nim.ts` already does. That includes `src/db/client.ts` (today it imports `@/data-dir`) and `src/db/queries.ts` (today it imports `./types`). `tsconfig.json` already sets `allowImportingTsExtensions`.

## Interfaces

```ts
// src/extract/date.ts
export interface ProposedDate {
  display: string | null;    // normalised display string, or the trimmed original when unknown
  start: string | null;      // YYYY-MM-DD
  end: string | null;        // YYYY-MM-DD
  precision: Precision;      // from PRECISIONS
  ambiguous: boolean;        // two-digit year, or D/M order not decidable
}
export function normalizeDate(raw: string | null, now?: Date): ProposedDate;

// src/extract/names.ts
export function displayName(raw: string): string;
export function nameKey(raw: string): string;

// src/extract/extract-item.ts
export interface ProposedEntity { name: string; nameKey: string; confidence: number }
export interface Proposal {
  title: string | null;
  description: string | null;
  transcription: string | null;
  date: ProposedDate;
  people: ProposedEntity[];
  places: ProposedEntity[];
  subjects: ProposedEntity[];
  confidence: Record<string, number>;   // passed through from the model, unchanged
}
export function deriveProposal(rawJson: string, now?: Date): Proposal;

export type ExtractOutcome =
  | { itemId: string; status: "extracted"; extractionId: string; model: string; promptVersion: string; latencyMs: number }
  | { itemId: string; status: "failed"; code: ExtractionErrorCode }
  | { itemId: string; status: "not_claimed"; current: ItemStatus | null };

export interface ExtractDeps {
  db: DatabaseSync;
  dataDir: string;
  extractor: Extractor;
  actor: string;              // "cli" for the script, the session actor for the route
  now?: () => Date;           // injected for tests
}
export interface BatchSummary { claimed: number; extracted: number; failed: number; queued: number; outcomes: ExtractOutcome[] }

export function createExtractor(env: NodeJS.ProcessEnv): Extractor;   // throws ExtractionError NO_KEY | CONFIG
export async function extractItem(itemId: string, deps: ExtractDeps): Promise<ExtractOutcome>;
export async function runBatch(deps: ExtractDeps, options: { limit: number; itemId?: string }): Promise<BatchSummary>;
```

## State machine

```
            extraction owns                                review owns
queued ──claim──> extracting ──ok──────────> needs_review ──accept──> published
                      │                         ▲    ▲                    │
                      └──ExtractionError────────┘    └──reopen── rejected ◄┘ reject
```

Extraction performs exactly two transitions: `queued → extracting` at the claim and `extracting → needs_review` at the finish. Both outcomes of a claimed item end in `needs_review`; only `items.error` and the presence of an `extractions` row tell them apart. Review never sees a `queued` item and ingest never produces `needs_review`.

## What extraction writes

| Target | Extraction | When |
|---|---|---|
| `items.status` | writes | `queued → extracting` at claim, `extracting → needs_review` at finish |
| `items.error` | writes | the `ExtractionErrorCode` on failure, `NULL` on success |
| `items.updated_at` | writes | at claim and at finish |
| other `items` columns | never | |
| `extractions` | inserts one row | on success only; never updated or deleted |
| `audit_events` | inserts one row | at finish, action `extract`, success or failure |
| `uploads/<sha256>.jpg` | reads | once per claimed item |
| `records` | never | review writes it on accept |
| `entities`, `item_entities` | never | proposed names stay in `raw_json` until a person accepts them |
| `places` | never | geocoding is archive's |

Because proposed names never leave `raw_json`, every row in `entities` was accepted by a person. That is what makes "the extractor never invents a name" checkable at the published layer: an invented name can appear in a proposal, flagged for review, but cannot reach a record without a human choosing it.

## Claim

```
BEGIN IMMEDIATE
  UPDATE items SET status = 'extracting', updated_at = :now
   WHERE id = (SELECT id FROM items WHERE status = 'queued' ORDER BY created_at, id LIMIT 1)
     AND status = 'queued'
  RETURNING id, stored_path
  -- --item=<id> uses: WHERE id = :id AND status = 'queued'
COMMIT
  zero rows  ⇒ another run owns it (or the queue is empty): no model call
  one row    ⇒ read uploads/<sha256>.jpg
              extractor.extract({ image, mimeType: "image/jpeg" })   ← no transaction open
BEGIN IMMEDIATE
  success: INSERT extractions (id, item_id, model, prompt_version, raw_json, latency_ms, created_at)
           UPDATE items SET status = 'needs_review', error = NULL, updated_at = :now
            WHERE id = :id AND status = 'extracting'
  failure: UPDATE items SET status = 'needs_review', error = :code, updated_at = :now
            WHERE id = :id AND status = 'extracting'
  INSERT audit_events (action 'extract', actor, before, after)
COMMIT
```

- `BEGIN IMMEDIATE` takes the write lock before the `UPDATE` reads, so two runs serialise on the claim and the second sees the item as no longer `queued`. No lock file, no claims table.
- The model call sits between the two transactions. A slow or retrying provider never blocks ingest or review writes.
- `SQLITE_BUSY` on either `BEGIN IMMEDIATE` is retried once after 50 ms, as ingest does; a second `BUSY` at the claim ends the run with that item unclaimed.
- `createExtractor()` runs once per run, before the first claim. `NO_KEY` and `CONFIG` are thrown by the adapter constructors, so a missing key or a Google base URL for NIM stops the run with every item still `queued`.
- Audit `before` is `{ status: "queued" }`; `after` is `{ status: "needs_review", extractionId, model, promptVersion }` on success or `{ status: "needs_review", error: code }` on failure.

## Failure mapping

`items.error` stores the code only. Provider messages can carry response bodies, so they go to neither the database nor the response; the server log gets the item id and the code. Review turns the code into the sentence it shows, next to the image and an empty, editable record (review Requirement 2 AC4).

| `ExtractionError` code | Raised when | Item after | `items.error` | `extractions` row | Review shows |
|---|---|---|---|---|---|
| `NO_KEY` | no API key in the environment | `queued` if raised by the constructor (the run stops before claiming); `needs_review` if raised by `extract()` | `NO_KEY` | none | "The model is not set up, so nothing was proposed." Fields empty; enter by hand or reject. |
| `CONFIG` | settings the adapter refuses, such as a Google base URL for NIM | as `NO_KEY` | `CONFIG` | none | "The model settings are wrong, so nothing was proposed." Fields empty; enter by hand or reject. |
| `AUTH` | provider answered 401 or 403 | `needs_review` | `AUTH` | none | "The model service refused the key." Fields empty; enter by hand or reject. |
| `RATE_LIMIT` | provider answered 429 after the adapter's retries | `needs_review` | `RATE_LIMIT` | none | "The model service was too busy to answer." Fields empty; enter by hand or reject. |
| `TIMEOUT` | no answer within the adapter timeout (60 s) after its retries | `needs_review` | `TIMEOUT` | none | "The model did not answer in time." Fields empty; enter by hand or reject. |
| `HTTP` | provider answered another 4xx | `needs_review` | `HTTP` | none | "The model service rejected the request." Fields empty; enter by hand or reject. |
| `SCHEMA` | output failed validation, the repair call failed, and coercion (NIM) could not save it | `needs_review` | `SCHEMA` | none | "The model's answer was not in the expected form." Fields empty; enter by hand or reject. |
| `PROVIDER` | 5xx after retries, a network fault, a non-JSON body, or no text | `needs_review` | `PROVIDER` | none | "The model service failed to answer." Fields empty; enter by hand or reject. |
| `BLOCKED` | provider declined the content | `needs_review` | `BLOCKED` | none | "The model service declined to read this image." Fields empty; enter by hand or reject. |
| (success) | output validated, or coerced by NIM | `needs_review` | `NULL` | one | The proposal from `deriveProposal()`, with model confidence on every field. |

There is no retry queue. The adapters already retry rate limits, 5xx and timeouts inside one call (up to three attempts); after that the item goes to review with its code. A volunteer who wants another try asks for re-extraction from review, which is review's action, not this spec's.

## Derived proposal

`raw_json` holds what the model returned. `deriveProposal(rawJson, now)` computes the proposal from it every time it is needed: parse with `extractionSchema`, run `normalizeDate` on `date.display`, run `displayName` and `nameKey` on every person, place and subject, drop exact `nameKey` duplicates within a type (keeping the higher confidence), and pass titles, description, transcription and confidence through unchanged. A date the adapter coerced arrives as precision `unknown` with `confidence.date = 0` and stays that way, so review marks it low.

The trade-off, stated:

- **Gained.** One stored copy, so the raw output and the proposal cannot disagree. Provenance shows exactly what the model said beside what the archive proposed. A fix to `normalizeDate` or `nameKey` applies to every unreviewed extraction without a data migration.
- **Paid.** The proposal is recomputed on every review read; it is pure and costs microseconds, but it is not free. A normaliser change also changes the proposal shown for an extraction made before the change. What a reviewer accepted does not move: `records` is written at accept time and the audit row snapshots it. Unreviewed proposals cannot be queried in SQL, which costs nothing today because no public surface reads them.
- **Constraint.** `deriveProposal` must stay pure. It takes `now` as a parameter, because the upper year bound is `currentYear + 1`.

## prompt_version migration

Archive conventions §5 makes the prompt version mandatory provenance, and `extractions` has no column for it. The fix has two halves:

1. `schema.sql` gains `prompt_version TEXT NOT NULL DEFAULT 'v1'` in `CREATE TABLE IF NOT EXISTS extractions`, so a fresh database has it.
2. `migrate()` runs `schema.sql` and then checks `PRAGMA table_info(extractions)`. If `prompt_version` is absent, it runs `ALTER TABLE extractions ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1'`. SQLite allows `ADD COLUMN ... NOT NULL` only with a non-null default, which is why the default exists.

`CREATE TABLE IF NOT EXISTS` does nothing to an existing table, so without the second half an existing database would never gain the column. The `PRAGMA` guard keeps `migrate()` safe to run twice; the existing migrate-twice test in `tests/unit/db.test.ts` stays green. The default is for the `ALTER` only: `extractItem` always writes the extractor's `promptVersion` explicitly, and no spike output is stored in `extractions`, so no existing row is mislabelled. This is the first migration that is not a bare `IF NOT EXISTS` statement; technical steering describes migrations that way, and the closing task records the exception.

## Configuration

`createExtractor(env)` reads `VISION_PROVIDER` (`nim` or `gemini`). ADR 0001 measured `nim`, so `nim` is the default and `.env.example` says so. Today `.env.example` sets `VISION_PROVIDER=gemini` and `VISION_BASE_URL` to the Google endpoint, which `NimExtractor` refuses with `CONFIG` on purpose so a NIM key is never sent to Google. Task 8 corrects the file so a fresh clone runs the provider the gate was measured on.

## Security

- `POST /api/admin/extract` calls the existing `requireAdmin()` before reading the body, and returns `500 CONFIG` for a missing or short `SESSION_SECRET`, as the ingest route does.
- The batch bound is `MAX_BATCH = 5` items per request. One request holds at most five model calls, each bounded by the adapter timeout and its retries.
- Logs carry item ids, codes and counts. They never carry API keys, provider response bodies, `raw_json` or transcriptions, which can contain names from captions.
- The image goes to the provider as base64 in the request body. Fixture and demo material is public-domain or institution-owned (technical steering), which is what makes sending it acceptable.

## Testing

- Unit, no network: `extractItem` and `runBatch` run against an `Extractor` test double that returns a fixed output or throws a chosen `ExtractionError`. `tests/unit/setup.ts` already fails any test that calls `fetch`.
- Table tests for `normalizeDate` (every row of the §1 accepted-inputs table, bounds, inversion, pivot, D/M ambiguity) and for `displayName` and `nameKey` (`Müller`, `李 小龙`, wrapping punctuation, whitespace).
- Property tests (`fast-check`): `normalizeDate` display idempotency (§1 rule 10); `start <= end` whenever both are non-null; every non-null year within bounds; `displayName` and `nameKey` idempotent; `nameKey(displayName(x)) === nameKey(x)`; combining marks survive `nameKey`.
- Claim: two connections to one temporary database file race on one queued item; the test double is called once.
- Failure: one case per `ExtractionErrorCode`: `needs_review`, `items.error` equals the code, zero `extractions` rows, one `extract` audit row.
- Boundary: after a success and after a failure, `records`, `entities`, `item_entities` and `places` all count zero.
- Route: handler called directly with a `Request`, as the ingest route tests do.

## Open points

These are not settled by the ten decisions behind this spec. Each blocks the task named.

1. **The exact output is not exposed (blocks task 4).** `Extractor.extract()` returns a parsed `Extraction`, not text. Requirement 2 AC2 needs the text the adapter accepted, and that text is not always one model response: the adapter may have made a repair call, and `NimExtractor` may have coerced a malformed date after the repair failed. Undecided: what `raw_json` holds in those two cases, and how `deriveProposal` reproduces a NIM coercion from it.
2. **One audit row versus every transition (blocks task 4).** The decision is one audit row per extraction. Technical steering says every status transition writes to `audit_events`, and ingest Requirement 5 AC4 says the same; the claim's `queued → extracting` is a committed transition with no row of its own under this design.
3. **Items left in `extracting` (blocks task 5).** Decision 2 covers `ExtractionError`. Two cases are not covered: an error that is not an `ExtractionError` (the upload file is missing, the finish transaction fails), and a process that dies between claim and finish. Either leaves the item in `extracting` with nothing that returns it to `queued` or sends it to review.
4. **No fixture extractor (blocks tasks 6 and 7).** Technical steering and `.env.example` describe `EXTRACTOR=fixture` and a `FixtureExtractor` that replays recorded extractions; neither exists in `src/`. Undecided: whether `createExtractor` must support `EXTRACTOR=fixture`, and how the route test gets a no-network extractor without one.
5. **Module locations (affects tasks 1, 2 and 6).** Structure steering puts date and name normalisation in `src/normalize/` and the batch runner in `src/jobs/`; both directories exist and are empty. This spec follows the decision (`src/extract/date.ts`, `src/extract/names.ts`, `scripts/extract.ts`). Either structure steering changes in task 9 or the paths do.
6. **Two-digit years against the gate (affects task 1 and the claim).** ADR rows 11 and 16 were scored correct with the model returning display `3-2-10` and `3-1-10` and start `1910-03-02` and `1910-03-01` (`spike-20261117T215437Z.json`, `spike-20261117T220621Z.json`). `normalizeDate` applies §1 rule 6's pivot of 30 to the display text, so the derived proposal for those items is March 2010, flagged ambiguous. The gate measured raw model output; review will show the normalised proposal. Undecided: whether that difference is accepted as the conventions working, or whether the model's own bounds play a part in the proposal.
