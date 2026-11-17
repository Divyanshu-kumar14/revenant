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
