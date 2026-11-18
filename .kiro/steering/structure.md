---
inclusion: always
---

# Revenant — Repository Structure

```
src/app/                 Next.js App Router
  page.tsx               public landing
  items/[id]/            public item page
  search/                public search + facets
  map/                   public map
  admin/
    login/               public sign-in page, outside the gate
    (protected)/         layout.tsx calls requireAdminPage(); ingest, review queue, review/[id], evals
  api/                   route handlers (ingest, batch, review, search, export, health)
src/archive/             read models: items, search, citation, geo, export
src/auth/                session cookie and requireAdmin(), password compare, login rate limiter
src/components/          design-system primitives and shell
src/db/                  client, schema.ts, migrations, typed queries, seed
src/extract/             Extractor interface, prompt, provider adapter, fixture replay
src/ingest/              hashing, image normalisation, idempotent ingest
src/jobs/                batch runner and job claiming
src/normalize/           date and name normalisation
src/review/              review decisions, audit events, publication
tests/unit/              Vitest: pure logic, DB with :memory:, fixture extraction
tests/e2e/               Playwright: real browser flows
tests/helpers/           arbitraries and shared test fixtures
scripts/                 spike-accuracy, fetch-fixtures, eval, geocode
fixtures/loc/            manifest.json + ground-truth.json (images are gitignored)
tools/loc-mcp/           project MCP server (search_items, get_item)
docs/specs/              product spec
docs/superpowers/plans/  implementation plan
docs/decisions/          ADRs, including the extraction promise
docs/kiro-log.md         daily evidence of Kiro usage
.kiro/steering/          always-on and file-matched rules
.kiro/specs/             ingest, review, archive feature specs
.kiro/hooks/             PostFileSave automation
.kiro/agents/            cataloger custom agent
.kiro/settings/mcp.json  project MCP registration
```

## Boundaries

- `src/app/**` composes; it does not contain business rules. A route handler validates input, calls one function in `src/`, and maps the result to a response.
- `src/archive/**` is read-only. It never writes. `src/review/**` and `src/ingest/**` write.
- `src/db/**` is the only place that imports `node:sqlite`.
- `src/extract/**` is the only place that knows a model provider exists.
- Tests import through `@/...` (mapped to `src/`). They never reach into another module's internals.

## Naming

- Database columns are `snake_case`; TypeScript types are `camelCase`; the mapping happens once, in `src/db/`.
- Dates in code are `string` in `YYYY-MM-DD`; display strings are separate fields and never parsed back for logic.
- Route handlers are `route.ts`; server actions live beside the feature that owns them, not in `app/`.
