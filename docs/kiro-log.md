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
