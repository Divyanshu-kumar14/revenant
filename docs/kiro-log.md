# Kiro usage log

Evidence, not prose. One entry per working session. The submission write-up is assembled from this file, so every claim here must point at a file, a command output or a screenshot.

**Fields:** date · surface (IDE / CLI / Web / Crew / none) · spec task · hook fired · MCP tool called · property/test failure caught · commit.

---

## 2026-11-18 — Harness authored, not yet driven from the IDE

**Surface:** none yet. The repository and the `.kiro/` harness were authored outside Kiro, then validated against `kiro.dev/docs` (hooks, steering, custom agents, specs, MCP configuration). This entry records that distinction rather than implying an IDE session that has not happened.

**Done**

- Decoded the Kiroween 2026 contract: five criteria at 20% each, hard disqualifiers, `.kiro/` required at the repo root and never gitignored.
- Installed and verified: Kiro IDE `1.4.178`. `kiro-cli` is a broken mise shim; Kiro Crew is not installed. Both are treated as gated stretch work, not assumptions.
- Scaffolded Next.js `16.4.6` with application code under `src/`, TypeScript strict, Tailwind 4, Cache Components enabled.
- Wrote four steering documents (`product`, `tech`, `structure`, `archive-conventions`), three `PostFileSave` hooks, a read-only `cataloger` agent, and the `loc` MCP registration.
- Wrote three feature specs — `ingest`, `review`, `archive` — each with requirements, design and tasks.
- Implemented the `loc` MCP server (`tools/loc-mcp/server.ts`): `search_items` and `get_item`, stdio, defensive against the LOC JSON shape.
- Added CI (typecheck, lint, unit, build, Playwright) and a submission-contract test that fails if `.kiro` is ignored or the license disappears.
- Pushed the first commit to `https://github.com/Divyanshu-kumar14/revenant`; GitHub detects MIT.

**Verified commands**

```
pnpm typecheck   → exit 0
pnpm lint        → exit 0
pnpm test        → 1 file, 3 tests passed
pnpm build       → compiled, 2 static routes
node tools/loc-mcp/server.ts → starts on stdio, exits 0 on EOF
```

**Findings that change the plan**

- `https://www.loc.gov/photos/?fo=json` returns a Cloudflare HTML challenge (HTTP 403) from this network. The fixture fetch and the MCP server need a different network or source. Recorded in the plan, T0 Step 3.
- The documented hook timeout field is `timeout_ms`, not `timeout`.

**Not yet done (do not claim otherwise)**

- No Kiro IDE session, no hook has fired, no MCP tool has been called from Kiro, no spec task has been executed by Kiro, no property-based test has run.
- No model provider selected; the accuracy gate is open.
- No deployed URL.

**Next entry must contain:** the first real hook hit (command, file, timestamp), the first MCP call from Kiro with its arguments, and the first spec task completed inside the IDE.

---

<!--
Template for future entries:

## YYYY-MM-DD — <one-line summary>

**Surface:** IDE / CLI / Web / Crew
**Spec task:** `.kiro/specs/<feature>/tasks.md` item N
**Hook:** <hook name> fired on <file>; output: <pass/fail + first line>
**MCP:** `loc/search_items` with `{ ... }` → <n> results
**Caught:** <property or test that failed, what it found, the fix>
**Commit:** <sha> <subject>
-->

## 2026-11-18 — Config load check: steering, spec and hook read back

**Surface:** IDE (agent session, read-only except this entry)
**Spec task:** none executed. `.kiro/specs/ingest/tasks.md` read: 10 tasks, 0 ticked.
**Steering:** `.kiro/steering/tech.md` and `structure.md` read and summarised.
**Hook:** none fired in this session (no file was saved). Config read from `.kiro/hooks/`: `typecheck-on-save.json` runs `pnpm typecheck` on `\.(ts|tsx)$`; `test-on-source-save.json` runs `pnpm test` on `^src/(db|ingest|extract|normalize|jobs|review|archive|auth)/.*\.ts$`; `eval-on-fixture-change.json` runs `pnpm eval` on `^fixtures/.*(manifest|ground-truth)\.json$`.
**MCP:** `loc` is registered in `.kiro/settings/mcp.json` (`node tools/loc-mcp/server.ts`, autoApprove `search_items`, `get_item`). Its tools were not exposed to this session and no call was made, so connection is unverified.
**Caught:** nothing yet.
**Commit:** none.

### 2026-11-18 — PostFileSave probe (follow-up to the entry above)

**Probe:** created `src/harness-probe.ts` (`export const HARNESS_PROBE: string = "postfilesave-probe";`) through the agent's file-write tool, then deleted it.
**Hook output:** none. The write tool result contained no hook output and no `pnpm typecheck` run was observed. Evidence that `Typecheck on TypeScript save` fired: **none**. An agent-tool write may not raise `PostFileSave`, which could be tied to a save made in the editor. This is unconfirmed either way.
**Manual typecheck after deletion:** `pnpm typecheck` → `next typegen && tsc --noEmit` → "Types generated successfully", exit code 0.
**Still open:** the first real hook hit must come from saving a `.ts` file in the editor and reading the hook output in Kiro's hook/output panel.

---

## 2026-11-18 — Harness live: the hooks execute, the MCP server connects

The entry above is wrong on one point, and this entry replaces it: "evidence that the hook fired: none" was a limit of what the agent can see, not a fact about the hook. The hook fires on agent edits and its command runs.

**Surface:** Kiro IDE 1.4.178, session `sess_0a2a7894-23e2-431a-8ef3-c8a27791bbd1`, workspace trusted.

### Trigger fires

From `~/.kiro/logs/20261117T210955522-313374/kiro.log`:

| Time (UTC) | Event |
|---|---|
| 21:11:23.620 | `str_replace` on `src/app/page.tsx` |
| 21:11:25.408 | `ContextualHookInvoked` — 1.8 s later |
| 21:11:49.201 | `str_replace`, revert of the same file |
| 21:11:50.613 | `ContextualHookInvoked` — 1.4 s later |
| 21:15:03.097 | `str_replace`, footer edit |
| 21:15:04.585 | two `ContextualHookInvoked` — one per matching hook |

### Command runs

A temporary hook (`.kiro/hooks/zz-probe.json`, since deleted) appended a UTC timestamp to `/tmp/opencode/probe-save.log`, outside the repo, on every `PostFileSave`. It recorded `21:15:04Z` and `21:15:17Z`, so the hook body executes, not just the trigger.

The real `pnpm typecheck` hook is confirmed by its own side effect: `.next/types/{routes,validator,cache-life,root-params}.d.ts` were rewritten at `21:15:16.690Z`, 13.6 s after the edit, and the agent ran **no** shell command that turn (`rg '21:1[5-9].*(execute_bash|run_command)'` → no matches). Only the hook could have launched it. `next typegen` completed, so the command starts and reaches the compiler.

### Why Kiro keeps saying "hook output: none"

It is accurate. Hook stdout and exit codes are not attached to the agent's tool result and do not appear in the chat; they belong to the Kiro output channel. The correct way to read them is **Output → Kiro Hooks**, not the agent.

### Trigger that was missing, and one that was not

Creating a file raises `PostFileCreate` **and** `PostFileSave`: one `fs_write` at `21:15:15.087` produced a probe line in `probe-create.log` at `21:15:16Z` and in `probe-save.log` at `21:15:17Z`, plus four `ContextualHookInvoked` events (two per trigger, one per matching hook). Adding `PostFileCreate` to the three hooks would therefore run `pnpm typecheck` and `pnpm test` twice per new file. They stay on `PostFileSave` only.

### MCP connects, the far end refuses

`mcp.log`: `mcp.connect.ok serverName:"loc"` at `21:09:58.183Z`, `mcp.listTools.ok` at `21:09:58.189Z`.

`loc/search_items` called once from the Kiro agent, verbatim:

```
MCP tool error: Library of Congress request failed: HTTP 403 (text/html; charset=UTF-8).
The Library of Congress returns an HTML challenge on some networks (Cloudflare).
Try from a different network or use already-downloaded fixtures.
```

One call, no retry. The server is not broken; the LOC edge is refusing this network. Fixtures need a different connection or a different public-domain source.

### What actually blocked the two earlier attempts

1. `hooks.v2.executionDisabledUntrustedWorkspace` — the folder was in Restricted Mode, so registered hooks could not run and the workspace MCP server never started. Granting trust fixed both.
2. The first probe created a *new* file, which raises `PostFileCreate`; only `PostFileSave` was registered. It would not have fired even with trust.

**Commit:** `docs: record the first verified Kiro hook run and the LOC 403`

## 2026-11-18 — Accuracy spike run

Surface: IDE agent session · model gemini-3.8-flash · prompt v1 · 20 items · extracted/failed: not available, `pnpm spike` printed only its header line and ended with exit code -1 (no summary line, no failures listed) · eval-runs file: none written by this run (the only file present, `spike-20261117T212643Z.json`, predates it). Run not completed; counts not recorded. Not retried.

2026-11-18 — Model default changed to gemini-2.5-flash (`.env.example`, `src/extract/provider.ts`); `pnpm typecheck` exit 0; `pnpm spike -- --limit=1 --model=gemini-2.5-flash` → 1 extracted, 0 failed, prompt v1, item spike-122036494, output `eval-runs/spike-20261117T213812Z.json`. One item only; no accuracy claim.

2026-11-18 — NIM vision adapter added (`src/extract/nim.ts`, `--provider=gemini|nim` in `scripts/spike-accuracy.ts`). Model `nvidia/nemotron-3.5-super-vl-120b-a12b`, chosen 2026-11-18 from the live catalog `https://integrate.api.nvidia.com/v1/models` (the docs page `/nim/docs/models` lists older LLMs only and no vision section; "vl" in the id is the basis, image support not yet confirmed by a real call). `pnpm typecheck` exit 0. Stubbed-fetch check: request shape, Retry-After retry, NO_KEY, CONFIG and AUTH mapping behave. Real-key run: not done, `pnpm spike -- --provider=nim --limit=1` stopped with NO_KEY because no NVIDIA key is configured.

NIM smoke test — 2026-11-18 · model `nvidia/nemotron-3.5-super-vl-120b-a12b` · prompt v1 · 1 extracted, 0 failed (item spike-122036494, 14582 ms) · `eval-runs/spike-20261117T215314Z.json` (records provider `nim`) · image input working: yes, the transcription contains postcard text ("PUBLISHED BY LOWMAN & HANFORD CO., SEATTLE") that is not in the reference title; correctness not scored.

NIM gate run — 2026-11-18 · provider nim · model `nvidia/nemotron-3.5-super-vl-120b-a12b` · prompt v1 · 20 items · 15 extracted, 5 failed (3 SCHEMA, 2 PROVIDER "returned no text") · `eval-runs/spike-20261117T215437Z.json`. No score claimed; scoring is by hand in ADR 0001.

## NIM reruns on the coerced adapter

```
spike-157695821: SCHEMA→PROVIDER no text (still failed)
spike-124931365: SCHEMA→extracted, day 1909-08-25, conf 0.95
spike-122041121: SCHEMA→extracted, day 1910-03-01, conf 0.90
spike-127485595: PROVIDER-empty→extracted, display "1860", unknown, conf 0.00
spike-157870943: PROVIDER-empty→extracted, unknown, conf 0.00
```

- Typecheck and test pass (2 files, 6 tests).
- Coercion-vs-model-zero indistinguishable in output.
- Model not repeatable run to run at temperature 0.

ADR 0001 closed — 2026-11-18 · provider nim · model `nvidia/nemotron-3.5-super-vl-120b-a12b` · prompt v1 · dates 19/20 correct, names 17/20 correct + 3 partial, 0 invented · promise "Catalogue with mandatory review" · scored by the owner against the images from base run `eval-runs/spike-20261117T215437Z.json` plus single-item reruns `T220528Z`, `T220558Z`, `T220621Z`, `T220641Z`, `T220714Z`, `T221647Z` (not one pass).

## 2026-11-18 — Ingest task 1: SQLite client and schema
Built `src/db/{client.ts,schema.sql,types.ts}` (WAL, foreign_keys=ON, eight tables, idempotent migrate); test-first: `tests/unit/db.test.ts` 1 test failed on unresolved `@/db/client`, then passed; full suite 3 files / 7 tests; `pnpm typecheck` exit 0, `pnpm test` exit 0.

## 2026-11-18 — Ingest task 2: typed query helpers
Added `src/db/queries.ts` (`insertItem`, `findItemBySha`, `getItem`, `countRows` with table allowlist, append-only `writeAudit`); test-first: 5 new tests in `tests/unit/db.test.ts` failed on unresolved `@/db/queries`, then passed; suite 3 files / 12 tests; `pnpm typecheck` exit 0, `pnpm test` exit 0.
## 2026-11-18 — Ingest task 3: contentHash
Added `src/ingest/hash.ts` (sync lowercase hex sha256) and `tests/unit/hash.test.ts` (empty-hash vector, distinct inputs, fast-check determinism/equality/distinctness); test-first: suite failed on unresolved `@/ingest/hash`, then passed; `pnpm typecheck` exit 0, `pnpm test` exit 0.
## 2026-11-18 — Ingest task 4: normalizeImage
Added `src/ingest/image.ts` (sharp rotate, 2048 fit-inside, jpeg q88 mozjpeg, minimal `IngestError` with `UNDECODABLE`) and `tests/helpers/images.ts`; test-first: `tests/unit/image.test.ts` failed on unresolved `@/ingest/image`; fixture root cause was the string EXIF tag via `withExif` being ignored (orientation stayed 1), fixed with `.withMetadata({ orientation })`; `pnpm typecheck` exit 0, `pnpm test` exit 0 (22 tests).
## 2026-11-18 — Ingest task 5: typed ingest errors
Added `src/ingest/errors.ts` (`IngestError` with `TOO_LARGE`/`UNDECODABLE`/`UNSUPPORTED_FORMAT`/`STORE_FAILED` and optional `detail`, `checkSize` 25 MiB default, `sniffUnsupported` HEIC ftyp-brand sniff, no sharp) and moved `image.ts` onto it; test-first: `tests/unit/errors.test.ts` failed with "Cannot find package '@/ingest/errors'", then passed; `pnpm typecheck` exit 0, `pnpm test` exit 0 (26 tests).
## 2026-11-18 — Ingest task 6: ingestFile
Added `src/ingest/ingest.ts` (checkSize → HEIC sniff → normalizeImage → contentHash of normalised bytes → `BEGIN IMMEDIATE`: findItemBySha ⇒ `duplicate_ingest` audit, else insertItem + `wx` write of `uploads/<sha256>.jpg` + `ingest` audit, ROLLBACK and file removal on failure; db and dataDir injected); test-first: `tests/unit/ingest.test.ts` failed with "Cannot find package '@/ingest/ingest'", then 6 tests passed (queued, duplicate, UNDECODABLE, TOO_LARGE, UNSUPPORTED_FORMAT, STORE_FAILED rollback); `pnpm typecheck` exit 0, `pnpm test` exit 0 (7 files, 32 tests).
## 2026-11-18 — Ingest task 7: admin upload route
Added `src/app/api/admin/ingest/route.ts` (SESSION_SECRET missing ⇒ 500 CONFIG; `requireAdmin` before the body ⇒ 401; Content-Length gate before `formData()` ⇒ 413, missing ⇒ 411; zod on file/fileName/caption ⇒ 400; TOO_LARGE 413, UNDECODABLE/UNSUPPORTED_FORMAT 422, STORE_FAILED 500, duplicate/queued 200; SQLITE_BUSY ⇒ one retry after 50 ms, then 503 BUSY; JSON `{ status, itemId?, sha256?, error? }`, never exception text) and the minimal `src/auth/session.ts` (`createSession`/`verifySession`/`requireAdmin`, HMAC-SHA256, 12 h expiry, `timingSafeEqual`); auth split: login, logout, cookie attributes and rate limiting stay in review Task 1, which reuses this module; test-first: `tests/unit/session.test.ts` and `tests/unit/ingest-route.test.ts` failed with "Cannot find package '@/auth/session'" / "'@/app/api/admin/ingest/route'", then passed (20 tests; retry path confirmed by a temporary ≥50 ms timing check over 3 runs); design.md Failure table gained the UNSUPPORTED_FORMAT row; `pnpm typecheck` exit 0, `pnpm test` exit 0 (52 tests, 9 files).
## 2026-11-18 — Ingest task 8: admin upload form
Added `src/app/admin/page.tsx` (server shell) and `src/app/admin/upload-form.tsx` (client: `accept="image/*" multiple` picker plus drop zone, one FormData POST per file to `/api/admin/ingest`, one row per file in an `aria-live="polite"` list: "Uploading…", "Queued for extraction", "Already in the archive", the server's `error.message`, "Sign in to continue." on 401; no caption field) and `tests/e2e/admin-upload.spec.ts` (cookie minted with `createSession("e2e", SESSION_SECRET)`, `@/` alias resolved under Playwright, two sharp-generated JPEGs of different size and colour, asserts two "Queued for extraction" rows inside the live region and no serious/critical axe violations on /admin); `playwright.config.ts` now runs `pnpm dev -p 3100` (the spec'd `pnpm dev -- -p 3100` failed: pnpm 10 forwards the `--` and next read `-p` as a project directory) with `SESSION_SECRET=e2e-secret-not-real` and `REVENANT_DATA_DIR` set to an `os.tmpdir()` mkdtemp with `uploads/` pre-created until Task 9's startup guard exists; temporary exposure: until review Task 2 adds the layout guard, /admin renders to anyone, but every POST without a valid cookie still returns 401 and the page shows no archive data; `pnpm typecheck` exit 0, `pnpm test` exit 0 (52 tests, 9 files), `pnpm lint` exit 0, `pnpm e2e` 3 passed.
## 2026-11-18 — Ingest hardening after Task 8 review
Six fixes: (1) `writeUpload` unlinks a regular file it created when the `wx` write fails with anything but EEXIST, never on EEXIST (tests: an orphaned earlier file survives a re-upload unchanged with STORE_FAILED; a directory at the target path gives STORE_FAILED and no file; the ENOSPC/EIO unlink branch itself is not exercised, since that needs a full filesystem); (2) ROLLBACK wrapped in try/catch behind the `isTransaction` guard so the original error and file cleanup always run (tested without a new seam by wrapping the injected db in a Proxy whose COMMIT and ROLLBACK throw); (3) session secrets under 32 characters throw `Session secret must be at least 32 characters.` and the route returns 500 CONFIG for them, logging the rule without the secret (tests: 31-character `createSession` throws, plus a route test; test and Playwright secrets padded to ≥32); (4) the route returns 413 TOO_LARGE from `file.size` before `arrayBuffer()` (test: MAX_UPLOAD_BYTES + 1 inside the Content-Length allowance, no row); (5) `limitInputPixels: 50_000_000` in `normalizeImage`, untested because exercising the cap needs a fixture over 200 MB; (6) `ingest-route.test.ts` afterEach deletes env vars that were originally undefined and removes the temp data dir. Reverting fixes 1 and 2 fails the three new ingest tests. Deferred: `PRAGMA busy_timeout` instead of the 50 ms retry (changes what the BUSY tests pin; waits for the batch runner) and closing cached connections on SIGTERM (SQLite recovers on next open). `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (58 tests, 9 files), `pnpm e2e` 3 passed.
## 2026-11-18 — Ingest task 9: startup guard
Added `src/data-dir.ts` (`resolveDataDir()` is the only `./data` default; `ensureDataDir()` mkdirs the data dir and `uploads/` recursively, writes and unlinks a `.write-probe-<pid>` in each, and throws `DataDirError` with the absolute path and errno code, or "exists but is not a directory" for a regular file) and `src/instrumentation.ts` (`register()` is async because it imports `@/data-dir` dynamically inside the `NEXT_RUNTIME === "nodejs"` branch, so the edge build never sees node:fs; logs and rethrows on failure); `register()` did run under `pnpm dev`: on a fresh nonexistent `REVENANT_DATA_DIR` it logged `instrumentation: data directory ready at …` and created `uploads/` before any request, and with a regular file as the data dir the dev server logged the message and exited 1; the ingest route calls `ensureDataDir` inside `database()` before `openDb` (connection cache unchanged) and `src/db/client.ts` defaults through `resolveDataDir()`; `playwright.config.ts` no longer pre-creates `uploads/`, and `tests/unit/ingest-route.test.ts` no longer creates it in beforeEach, so the route's success tests pass only because the route creates it (commenting out the route's `ensureDataDir` call failed 3 of them with STORE_FAILED); `tests/unit/data-dir.test.ts` covers creation under a missing path, idempotence, EACCES under a 0o500 parent (skipped as root; ran here as uid 1000), the regular-file message, and one `register()` call against a temp `REVENANT_DATA_DIR`; `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (63 tests, 10 files), `pnpm e2e` 3 passed without the manual mkdir.
## 2026-11-18 — Ingest: diagnosable data-directory failures
The ingest route's final catch now logs `ingest route: INTERNAL <code> <message>` for a `DataDirError` (message built only from the configured path and errno code), so the path and errno reach the server log; every other unknown error still logs its name only, and the response stays 500 INTERNAL with no path; no test, because the change is log content only; `pnpm typecheck` exit 0.
## 2026-11-18 — Ingest task 10: conventions recorded, spec closed
The ingest spec is complete at ten of ten tasks; `.kiro/steering/archive-conventions.md` gained rule 11 in section 1 (Dates: a date is evidence only from the image, caption or existing metadata), one bullet in section 3 (Confidence: an adapter-coerced date is precision `unknown`, confidence `0`) and a new section 9 (Ingest: identity, normalisation, `queued` status, status values, append-only audit, route status codes, boot-time data-directory check); docs only, `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (63 tests, 10 files).
## 2026-11-18 — Ingest conventions corrected to match the implementation
Corrected `.kiro/steering/archive-conventions.md`: section 5 now says only the normalised JPEG (2048 px, q88) is retained, the original is discarded, and every derivative is regenerated from the retained copy; section 9 now describes the tightened HEIF check (`sniffUnsupported` parses the `ftyp` box and refuses `heic`/`heix`/`hevc`/`hevx` as major or compatible brand, 8d2fbf9), widens 400 to unreadable or invalid forms and 500 to storage, configuration or unexpected failures, and states that the route repeats the data-directory check on first database open, so a directory that turns unwritable after boot fails the upload with 500; docs only, `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (69 tests, 10 files).
## 2026-11-18 — Extract spec written
Wrote `.kiro/specs/extract/` (requirements.md, design.md, tasks.md) in the ingest spec's shape: 7 requirements and 9 tasks covering the claim, provenance with the new `extractions.prompt_version`, conventions enforcement, failures reaching review with their code, `pnpm extract`, `POST /api/admin/extract` (bound 5) and the no-publication boundary; design.md lists 6 open points that block or affect named tasks (raw output not exposed by `Extractor`, one audit row vs every transition, items stranded in `extracting`, no `FixtureExtractor`, `src/normalize`/`src/jobs` locations in structure steering, and the two-digit pivot turning ADR rows 11 and 16 into 2010); docs only, `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (69 tests, 10 files, submission contract included).
## 2026-11-18 — Extract spec: six rulings applied
Amended `.kiro/specs/extract/` (now 9 requirements, 11 tasks) with six rulings: `extract()` returns `ExtractionResult { extraction, raw, repaired, coerced }`, `raw` stored in `raw_json` and the flags in the `extract` audit row (touches both adapters and the spike script); structured dates win over display text, a disagreeing display sets `ambiguous` (gate case `3-2-10` + `1910-03-02` → March 2, 1910, never 2010), also added to `.kiro/steering/archive-conventions.md` §1 rule 6; two audit rows per attempt (`extract_started`, then `extract`/`extract_failed`/`extract_interrupted`); non-`ExtractionError` failures map to `INTERNAL` and the runner requeues claims older than fifteen minutes (above the 480 s NIM worst case); new `src/extract/fixture.ts` and task; normalisers moved to `src/normalize/`, batch logic to `src/jobs/extract.ts`, with the relative-`.ts` import chain and `MAX_BATCH = 5` (median 14.5 s per successful item in `eval-runs/spike-20261117T215437Z.json`) recorded; docs only, `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (69 tests, 10 files).
## 2026-11-18 — Extract task 1: date normalisation
Added `src/normalize/date.ts` (`normalizeDate(input, structured?, now?)` returning `NormalizedDate`; one function with a structured argument instead of the spec's separate `proposeDate`, and `Precision` imported from `../extract/provider.ts` so plain `node` loads it, confirmed by running it under `node`): every §1 table shape, bounds 1800..currentYear+1, start <= end, northern seasons with winter into February, circa ±5, pivot 30 for two-digit years, month-first numerics flagged ambiguous, rule 9 displays with an en dash; valid structured spans win, and a display text whose reading (taken without bounds) does not contain the structured span sets `ambiguous`; `tests/unit/date.test.ts` covers each table row, the ADR gate cases (`3-2-10`/`3-1-10` → March 1910, ambiguous, never 2010), `25/12/1938`, `03/04/1938`, out-of-bounds, inverted, null/blank, plus fast-check properties for display and bounds idempotency, ordering and bounds, structured-wins, and year-only inputs never gaining a month or day; the properties passed on the first run, so they caught nothing; `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test` exit 0 (100 tests, 11 files).
