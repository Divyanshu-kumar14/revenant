# Design — Extract

## Context

An item leaves ingest as `queued` with a normalised JPEG at `uploads/<sha256>.jpg`. Extraction claims it, sends the image to the vision model behind the `Extractor` interface, stores what came back with its provenance, and moves the item to `needs_review`. Two entry points start it: `pnpm extract` and `POST /api/admin/extract`. Both call the same batch runner in `src/jobs/extract.ts`. Nothing starts extraction on upload, and no process runs in the background.

The provider adapters, the prompt and the error codes already exist from the accuracy spike: `Extractor`, `ExtractionError`, `ExtractionErrorCode`, `extractionSchema` and `PRECISIONS` in `src/extract/provider.ts`, `NimExtractor` in `src/extract/nim.ts`, and `EXTRACTION_PROMPT` with `PROMPT_VERSION = "v1"` in `src/extract/prompt.ts`. This spec changes one thing about them, the return type of `extract()` (see Interfaces), and otherwise uses them as they are.

The evidence base is ADR 0001: one NIM base run of 20 items plus five single-item reruns, assembled from seven `eval-runs/spike-20261117T*.json` files, giving the promise "catalogue with mandatory review". That result covers those 20 items, model `nvidia/nemotron-3.5-super-vl-120b-a12b` and prompt `v1`. Nothing in this spec claims more.

## Components

```
src/normalize/date.ts               normalizeDate(), proposeDate(): archive conventions §1
src/normalize/names.ts              displayName(), nameKey(): archive conventions §2
src/extract/provider.ts             Extractor, ExtractionResult, ExtractionError, extractionSchema, GeminiExtractor (exists)
src/extract/nim.ts                  NimExtractor (exists); its date salvage is exported for deriveProposal
src/extract/prompt.ts               EXTRACTION_PROMPT, PROMPT_VERSION (exists)
src/extract/fixture.ts              FixtureExtractor: fixed fake output, no network
src/extract/extract-item.ts         createExtractor(); extractClaimed(): model call and finish; deriveProposal()
src/jobs/extract.ts                 requeueStale(), claim(), runBatch(): the batch runner
scripts/extract.ts                  pnpm extract: argument parsing and printing only
src/app/api/admin/extract/route.ts  session gate, body validation, bounded runBatch(), counts
src/db/schema.sql, src/db/client.ts extractions.prompt_version and its guarded ALTER
```

Why the modules sit where they do:

- **Normalisation lives in `src/normalize/`** because it is shared. Extraction uses it to derive proposals, review uses `normalizeDate` and `nameKey` when a volunteer edits a date or a name, and archive uses `nameKey` for facets. Placing it in `src/extract/` would make review and archive depend on the module that knows a model provider exists. Both files are pure and import nothing outside the standard library and `PRECISIONS`.
- **Batch logic lives in `src/jobs/extract.ts`**, the directory structure steering reserves for the batch runner and job claiming. `scripts/extract.ts` parses arguments, calls `runBatch`, prints, and sets the exit code; the route calls the same `runBatch`. Neither entry point holds logic the other lacks.
- **`src/extract/**` stays the only place that knows a provider exists.** The runner and the route call `createExtractor()` and never name an adapter.

Two constraints, fixed here:

- **`tsx` loads the scripts, so `@/` stays everywhere.** `scripts/extract.ts` runs as `node --env-file-if-exists=.env.local --import tsx scripts/extract.ts`; the `tsx` loader resolves both the `@/` alias and extensionless relative imports, verified on this repo. No module changes its import style for the runner, `src/db/client.ts` keeps `@/data-dir`, and `src/db/queries.ts` keeps `./types`. `tsconfig.json` keeps `allowImportingTsExtensions` because `scripts/spike-accuracy.ts` still uses explicit `.ts` specifiers under plain `node`; that script is unchanged.
- **`MAX_BATCH = 5`.** Five extractions take roughly 75 seconds: successful items in the NIM base run (`eval-runs/spike-20261117T215437Z.json`, 15 items) took a median of 14.5 s each. Five also bounds the token spend one click can cause.

## Interfaces

`deriveProposal` re-derives the date from `raw_json` using the same salvage the adapter applied. Today `extractJsonObject` is a private copy in both `src/extract/provider.ts` (line 281) and `src/extract/nim.ts` (line 307); task 6 exports the `provider.ts` copy, imports it in `nim.ts` and deletes the duplicate, so both adapters and `deriveProposal` share one parser. A third copy is what would let `raw_json` stop round-tripping.

```ts
// src/extract/provider.ts — changed: extract() returns ExtractionResult instead of Extraction
export interface ExtractionResult {
  extraction: Extraction;   // validated, or salvaged by the NIM adapter
  raw: string;              // the model's final response text, exactly as received
  repaired: boolean;        // the repair call was used; raw is the repair response
  coerced: boolean;         // the NIM adapter salvaged an invalid date
}
export interface Extractor {
  readonly model: string;
  readonly promptVersion: string;
  extract(input: ExtractInput): Promise<ExtractionResult>;
}

// src/normalize/date.ts
export interface ProposedDate {
  display: string | null;    // rendered per §1 rule 9, or the trimmed original when unknown
  start: string | null;      // YYYY-MM-DD
  end: string | null;        // YYYY-MM-DD
  precision: Precision;      // from PRECISIONS
  ambiguous: boolean;        // two-digit year, undecidable D/M, or display disagrees with structured
}
export function normalizeDate(raw: string | null, now?: Date): ProposedDate;   // display text only
export function proposeDate(
  date: { display: string | null; start: string | null; end: string | null; precision: Precision },
  now?: Date,
): ProposedDate;                                                                // structured first

// src/normalize/names.ts
export function displayName(raw: string): string;
export function nameKey(raw: string): string;

// src/extract/fixture.ts
export class FixtureExtractor implements Extractor {}   // model "fixture", promptVersion "fixture"

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
export type FailureCode = ExtractionErrorCode | "INTERNAL";
export type ExtractOutcome =
  | { itemId: string; status: "extracted"; extractionId: string; model: string; promptVersion: string; latencyMs: number }
  | { itemId: string; status: "failed"; code: FailureCode }
  | { itemId: string; status: "not_claimed"; current: ItemStatus | null };
export interface ExtractDeps {
  db: DatabaseSync;
  dataDir: string;
  extractor: Extractor;
  actor: string;              // "cli" for the script, the session actor for the route
  now?: () => Date;           // injected for tests
}
export function createExtractor(env: NodeJS.ProcessEnv): Extractor;   // throws ExtractionError NO_KEY | CONFIG
export async function extractClaimed(item: ClaimedItem, deps: ExtractDeps): Promise<ExtractOutcome>;
export function deriveProposal(rawJson: string, now?: Date): Proposal;

// src/jobs/extract.ts
export interface ClaimedItem { id: string; storedPath: string }
export interface BatchSummary {
  requeued: number; claimed: number; extracted: number; failed: number; queued: number;
  outcomes: ExtractOutcome[];
}
export function requeueStale(db: DatabaseSync, actor: string, now: Date): string[];
export function claim(db: DatabaseSync, actor: string, now: Date, itemId?: string): ClaimedItem | null;
export async function runBatch(deps: ExtractDeps, options: { limit: number; itemId?: string }): Promise<BatchSummary>;
```

The `ExtractionResult` change is to an internal interface, but it is not local. It touches both adapters (`GeminiExtractor` and `NimExtractor` return the text they validated and the two flags), the spike script (`scripts/spike-accuracy.ts` reads `.extraction` from the result), and `tests/unit/nim-coerce.test.ts`. Eval-run files written before the change are unaffected.

`createExtractor(env)` returns `FixtureExtractor` when `EXTRACTOR=fixture`. `EXTRACTOR=provider`, or an unset value, reads `VISION_PROVIDER` (`nim` or `gemini`, default `nim`) and constructs that adapter, which throws `NO_KEY` or `CONFIG` from its constructor when the environment is wrong; any other `EXTRACTOR` value is `CONFIG`. Adapters receive every setting as an option and read no environment themselves, so `createExtractor(env)` is the only place the environment is read and a test that passes an env cannot be influenced by the shell it runs in.

## State machine

```
            extraction owns                                review owns
queued ──claim──> extracting ──ok──────────> needs_review ──accept──> published
  ▲                   │  │                      ▲    ▲                    │
  └──stale > 15 min───┘  └──any failure─────────┘    └──reopen── rejected ◄┘ reject
```

Extraction performs three transitions: `queued → extracting` at the claim, `extracting → needs_review` at the finish, and `extracting → queued` when a run finds a claim older than fifteen minutes. Success and failure both end in `needs_review`; only `items.error` and the presence of an `extractions` row tell them apart. Review never sees a `queued` item and ingest never produces `needs_review`.

## What extraction writes

| Target | Extraction | When |
|---|---|---|
| `items.status` | writes | `queued → extracting` at claim, `extracting → needs_review` at finish, `extracting → queued` at a stale requeue |
| `items.error` | writes | the failure code (an `ExtractionErrorCode` or `INTERNAL`) at a failed finish; `NULL` at claim and at a successful finish |
| `items.updated_at` | writes | at every status change |
| other `items` columns | never | |
| `extractions` | inserts one row | on success only; never updated or deleted |
| `audit_events` | inserts two rows per attempt | `extract_started` at claim; then `extract`, `extract_failed` or `extract_interrupted` |
| `uploads/<sha256>.jpg` | reads | once per claimed item |
| `records` | never | review writes it on accept |
| `entities`, `item_entities` | never | proposed names stay in `raw_json` until a person accepts them |
| `places` | never | geocoding is archive's |

Because proposed names never leave `raw_json`, every row in `entities` was accepted by a person. That is what makes "the extractor never invents a name" checkable at the published layer: an invented name can appear in a proposal, flagged for review, but cannot reach a record without a human choosing it.

Audit rows, all with the run's actor:

| Action | Written in | `before_json` | `after_json` |
|---|---|---|---|
| `extract_started` | claim transaction | `{ status: "queued" }` | `{ status: "extracting" }` |
| `extract` | finish transaction | `{ status: "extracting" }` | `{ status: "needs_review", extractionId, model, promptVersion, repaired, coerced }` |
| `extract_failed` | finish transaction | `{ status: "extracting" }` | `{ status: "needs_review", error: code }` |
| `extract_interrupted` | requeue transaction | `{ status: "extracting", since: updated_at }` | `{ status: "queued" }` |

## Claim

```
BEGIN IMMEDIATE                                   ← requeueStale, once per run, before the first claim
  UPDATE items SET status = 'queued', updated_at = :now
   WHERE status = 'extracting' AND updated_at < :now_minus_15_min
  RETURNING id, updated_at
  INSERT audit_events 'extract_interrupted' per returned row
COMMIT

BEGIN IMMEDIATE                                   ← claim
  UPDATE items SET status = 'extracting', error = NULL, updated_at = :now
   WHERE id = (SELECT id FROM items WHERE status = 'queued' ORDER BY created_at, id LIMIT 1)
     AND status = 'queued'
  RETURNING id, stored_path
  -- --item=<id> uses: WHERE id = :id AND status = 'queued'
  INSERT audit_events 'extract_started'           ← only when a row was returned
COMMIT
  zero rows  ⇒ another run owns it, or the queue is empty: no model call
  one row    ⇒ read uploads/<sha256>.jpg
              extractor.extract({ image, mimeType: "image/jpeg" })   ← no transaction open

BEGIN IMMEDIATE                                   ← finish
  success: INSERT extractions (id, item_id, model, prompt_version, raw_json = result.raw, latency_ms, created_at)
           UPDATE items SET status = 'needs_review', error = NULL, updated_at = :now
            WHERE id = :id AND status = 'extracting'
           INSERT audit_events 'extract'
  failure: UPDATE items SET status = 'needs_review', error = :code, updated_at = :now
            WHERE id = :id AND status = 'extracting'
           INSERT audit_events 'extract_failed'
COMMIT
```

- `BEGIN IMMEDIATE` takes the write lock before the `UPDATE` reads, so two runs serialise on the claim and the second sees the item as no longer `queued`. No lock file, no claims table.
- The model call sits between the claim and the finish. A slow or retrying provider never blocks ingest or review writes.
- `SQLITE_BUSY` on any `BEGIN IMMEDIATE` is retried once after 50 ms, as ingest does; a second `BUSY` at the claim ends the run with that item unclaimed.
- `createExtractor()` runs once per run, before `requeueStale` and the first claim. A missing key or a Google base URL for NIM stops the run with every item still `queued`.
- **Fifteen minutes is above the worst case for one live claim.** `NimExtractor` makes at most two calls per item (first and repair), each up to three attempts of 60 s with up to 30 s backoff between attempts: 2 × (3 × 60 + 2 × 30) = 480 s. `GeminiExtractor` is lower. A requeue therefore only catches an item whose process is gone, never one still being extracted. The runner extracts items one at a time, and each claim sets `updated_at`, so the bound applies per item, not per batch.

## Failure mapping

Every claimed item reaches `needs_review`, whatever goes wrong. The extractor's `ExtractionError` codes are stored as they are. Any other error becomes `INTERNAL`: a missing upload file, a non-`ExtractionError` thrown by an adapter, or a failed success-path finish transaction. In the last case, `extractClaimed` runs the failure finish in a new transaction. If that also fails, the item stays `extracting` until the next run's stale requeue returns it to `queued`. So no failure leaves an item stuck for good.

`items.error` stores the code only. Error messages can carry provider response bodies or file paths, so they go to neither the database nor the response. The server log gets the item id and the code, plus the error name for `INTERNAL`. Review turns the code into the sentence it shows, next to the image and an empty, editable record (review Requirement 2 AC4).

| Failure code | Raised when | Item after | `items.error` | `extractions` row | Review shows |
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
| `INTERNAL` | any error that is not an `ExtractionError`: missing upload file, unexpected adapter error, failed finish | `needs_review` | `INTERNAL` | none | "Something went wrong on our side, so nothing was proposed." Fields empty; enter by hand or reject. |
| (success) | output validated, or coerced by NIM | `needs_review` | `NULL` | one | The proposal from `deriveProposal()`, with model confidence on every field. |

There is no retry queue. The adapters already retry rate limits, 5xx and timeouts inside one call (up to three attempts); after that the item goes to review with its code. The stale requeue is not a retry: it catches an attempt that never finished, not one that failed. A volunteer who wants another try after a failure asks for re-extraction from review, which is review's action, not this spec's.

## Derived proposal

`raw_json` holds the model's final response text exactly as received. `deriveProposal(rawJson, now)` computes the proposal from it every time it is needed:

1. Extract the JSON object from the text and validate it with `extractionSchema`. If validation fails, apply the same date salvage `NimExtractor` applied when it accepted the response; the function is exported from `nim.ts` and shared, so the two cannot diverge. A salvaged date is precision `unknown` with `confidence.date = 0`, and its display text is not parsed into a date (§3).
2. Run `proposeDate` on the date object. Structured `start`, `end` and `precision` are primary: when they are valid under §1 (real `YYYY-MM-DD` dates, years within `1800..currentYear + 1`, `start <= end`, precision other than `unknown`), they are kept and `display` is rendered from them per rule 9. The display text is parsed with `normalizeDate` only to compare: if its parse yields a known precision whose start or end year differs from the structured one, `ambiguous` is set. When the structured fields are absent or invalid, `normalizeDate` on the display text is the proposal.
3. Run `displayName` and `nameKey` on every person, place and subject; drop exact `nameKey` duplicates within a type, keeping the higher confidence.
4. Pass title, description, transcription and confidence through unchanged.

The gate case: ADR 0001 row 11 returned display `3-2-10` with start and end `1910-03-02` at precision `day` (`eval-runs/spike-20261117T215437Z.json`). The structured date is valid, so the proposal is `March 2, 1910`. Parsing `3-2-10` under rule 6's pivot gives 2010, which disagrees, so `ambiguous` is `true`. Row 16 (`3-1-10`, `1910-03-01`, `eval-runs/spike-20261117T220621Z.json`) behaves the same way.

The trade-off, stated:

- **Gained.** One stored copy, so the raw output and the proposal cannot disagree. Provenance shows exactly what the model said beside what the archive proposed. A fix to `proposeDate` or `nameKey` applies to every unreviewed extraction without a data migration.
- **Paid.** The proposal is recomputed on every review read; it is pure and costs microseconds, but it is not free. A normaliser change also changes the proposal shown for an extraction made before the change. What a reviewer accepted does not move: `records` is written at accept time and the audit row snapshots it. Unreviewed proposals cannot be queried in SQL, which costs nothing today because no public surface reads them.
- **Constraint.** `deriveProposal` must stay pure and must accept every `raw` an adapter accepted. It takes `now` as a parameter, because the upper year bound is `currentYear + 1`.

## prompt_version migration

Archive conventions §5 makes the prompt version mandatory provenance, and `extractions` has no column for it. The fix has two halves:

1. `schema.sql` gains `prompt_version TEXT NOT NULL DEFAULT 'v1'` in `CREATE TABLE IF NOT EXISTS extractions`, so a fresh database has it.
2. `migrate()` runs `schema.sql` and then checks `PRAGMA table_info(extractions)`. If `prompt_version` is absent, it runs `ALTER TABLE extractions ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1'`. SQLite allows `ADD COLUMN ... NOT NULL` only with a non-null default, which is why the default exists.

`CREATE TABLE IF NOT EXISTS` does nothing to an existing table, so without the second half an existing database would never gain the column. The `PRAGMA` guard keeps `migrate()` safe to run twice; the existing migrate-twice test in `tests/unit/db.test.ts` stays green. The default is for the `ALTER` only: the finish always writes the extractor's `promptVersion` explicitly, and no spike output is stored in `extractions`, so no existing row is mislabelled. `repaired` and `coerced` need no column; they live in the `extract` audit row. This is the first migration that is not a bare `IF NOT EXISTS` statement; technical steering describes migrations that way, and the closing task records the exception.

## Configuration

ADR 0001 measured `nim`, so `VISION_PROVIDER` defaults to `nim` and `.env.example` says so. Today `.env.example` sets `VISION_PROVIDER=gemini` and `VISION_BASE_URL` to the Google endpoint, which `NimExtractor` refuses with `CONFIG` on purpose so a NIM key is never sent to Google. It also sets `EXTRACTOR=fixture`, under which `createExtractor` never reaches a provider. The `.env.example` task corrects all three so a fresh clone runs the provider the gate was measured on. Unit tests keep `EXTRACTOR=fixture` from `tests/unit/setup.ts`, and Playwright sets it in `webServer.env`, so neither depends on `.env.local`.

## Security

- `POST /api/admin/extract` calls the existing `requireAdmin()` before reading the body, and returns `500 CONFIG` for a missing or short `SESSION_SECRET`, as the ingest route does.
- One request runs at most `MAX_BATCH = 5` extractions (see Components).
- Logs carry item ids, codes and counts. They never carry API keys, provider response bodies, `raw_json` or transcriptions, which can contain names from captions.
- The image goes to the provider as base64 in the request body. Fixture and demo material is public-domain or institution-owned (technical steering), which is what makes sending it acceptable.

## Testing

- Unit, no network: the runner and `extractClaimed` run against `FixtureExtractor` and an `Extractor` test double that throws a chosen error. `tests/unit/setup.ts` already fails any test that calls `fetch`.
- Table tests for `normalizeDate` (every row of the §1 accepted-inputs table, bounds, inversion, pivot, D/M ambiguity) and `proposeDate` (structured valid, structured invalid, structured absent, display disagreeing, the `3-2-10` gate case), and for `displayName` and `nameKey` (`Müller`, `李 小龙`, wrapping punctuation, whitespace).
- Property tests (`fast-check`): `normalizeDate` display idempotency (§1 rule 10); `start <= end` whenever both are non-null, for both date functions; every non-null year within bounds; `displayName` and `nameKey` idempotent; `nameKey(displayName(x)) === nameKey(x)`; combining marks survive `nameKey`.
- Adapters: with an injected `fetchImpl`, `raw` equals the response text byte for byte, `repaired` is true only when the repair call ran, and `coerced` is true only when the salvage ran.
- Claim: two connections to one temporary database file race on one queued item; the extractor is called once.
- Audit: each outcome writes exactly two rows in order; a stale requeue writes `extract_interrupted`; an item claimed fourteen minutes ago is not requeued.
- Failure: one case per failure code, `INTERNAL` included: `needs_review`, `items.error` equals the code, zero `extractions` rows, `extract_failed` written.
- Boundary: after a success and after a failure, `records`, `entities`, `item_entities` and `places` all count zero.
- Route: handler called directly with a `Request`, as the ingest route tests do, under `EXTRACTOR=fixture`.
