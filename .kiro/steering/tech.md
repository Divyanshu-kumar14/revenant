---
inclusion: always
---

# Revenant — Technical Steering

## Runtime

- Node `>=26` (see `.nvmrc`), pnpm `10`, lockfile committed. Do not switch package managers.
- Next.js **16** App Router under `src/app`, React 19, TypeScript strict, Tailwind 4.
- **Next.js 16 differs from your training data.** Before writing routing, caching, font, metadata or config code, read the relevant file under `node_modules/next/dist/docs/`. Do not guess an API from Next 14/15 habits.
- Cache Components is enabled (`cacheComponents: true`, `partialPrefetching: true`). Data access is dynamic by default; cache deliberately with `use cache` + `cacheLife`/`cacheTag`, never by accident.

## Commands

| Need | Command |
|---|---|
| typecheck | `pnpm typecheck` |
| lint | `pnpm lint` |
| unit tests | `pnpm test` |
| one test file | `pnpm vitest run tests/unit/<name>.test.ts` |
| browser tests | `pnpm e2e` |
| build | `pnpm build` |
| evaluation | `pnpm eval` |
| accuracy gate | `pnpm spike` |

Never claim a change works without running the narrowest relevant command and reading its output.

## Data

- SQLite through `node:sqlite` (`DatabaseSync`). No ORM, no query builder. SQL lives in `src/db/`.
- WAL mode; `PRAGMA foreign_keys=ON`; migrations are idempotent `CREATE ... IF NOT EXISTS` statements and must be safe to run twice. One exception exists: `CREATE TABLE IF NOT EXISTS` cannot add a column to an existing table, so `migrate()` adds `extractions.prompt_version` with an `ALTER TABLE` guarded by `PRAGMA table_info`, which is safe to run repeatedly. Any future column addition follows the same pattern.
- Database at `$REVENANT_DATA_DIR/revenant.db`; uploads at `$REVENANT_DATA_DIR/uploads/<sha256>.jpg`; default `./data`.
- `items.sha256` is unique. Re-ingesting identical bytes returns the existing item and writes an audit event; it never creates a second item.
- An item is publicly visible only when `status = 'published'`. Every status transition writes to `audit_events`.
- `date_start <= date_end` whenever both exist. Store dates as ISO `YYYY-MM-DD` strings, never JS `Date` objects in the database.
- Parameterised statements only. Never interpolate a value into SQL.

## Extraction

- All model access sits behind the `Extractor` interface in `src/extract/provider.ts`. Route handlers, jobs and UI never call a provider directly.
- Unit tests use `FixtureExtractor`, which returns one fixed, obviously fake extraction (title "Fixture: mill pond at first light", model `fixture`, prompt version `fixture`) for every input and reads no image. Unit tests must not touch the network. `tests/unit/setup.ts` fails a test that calls `fetch`.
- Malformed JSON, schema violations and timeouts become `ExtractionError` with a typed code. The item goes to `needs_review` with the error visible; no `records` row is written and nothing is published.
- Prompts are versioned files (`src/extract/prompt.ts`) so an eval run can name the prompt it used.

## Security and privacy

- Public pages are unauthenticated. `/admin/**` and `/api/admin/**` require an `httpOnly`, `sameSite=lax` cookie signed with `SESSION_SECRET` alone; `ADMIN_PASSWORD` is only compared at login. Compare secrets with `timingSafeEqual`.
- Validate every request body with `zod` at the trust boundary. Reject oversized uploads by content length before buffering.
- Do not log secrets, full request headers, or personal data from captions. Log item ids and error codes.
- Fixture and demo material must be public-domain or institution-owned, with a rights line on every published item. Never infer a living person's identity.

## Testing and style

- Test behaviour through the public interface, not private helpers. One assertion theme per test.
- Property-based tests (`fast-check`) for parsers, normalisers, hashing and CSV round-trips. A property failure is a finding, not an inconvenience: record what it caught in `docs/kiro-log.md`.
- No `any` in exported signatures. No non-null assertions to silence the compiler; narrow instead.
- Errors are values with a code and a human message. No empty `catch`.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

## Definition of done for every task

`pnpm typecheck` and `pnpm test` pass, the task checkbox in `.kiro/specs/<feature>/tasks.md` is ticked, one line is appended to `docs/kiro-log.md`, and the change is committed. If a gate cannot be verified (no key, no host), say so explicitly instead of marking it done.
