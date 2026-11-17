# Implementation Tasks — Ingest

> Execute in order. Each task ends with `pnpm typecheck && pnpm test`, a ticked checkbox, one line in `docs/kiro-log.md`, and a commit.

- [x] 1. Create the SQLite client and schema (`src/db/client.ts`, `src/db/schema.sql`, `src/db/types.ts`): WAL, `foreign_keys=ON`, `items`, `extractions`, `records`, `entities`, `item_entities`, `places`, `audit_events`, `eval_runs`. Verify: a test opens `:memory:`, migrates twice, and a duplicate `sha256` insert throws.
- [x] 2. Add typed query helpers (`src/db/queries.ts`): `insertItem`, `findItemBySha`, `getItem`, `countRows`, `writeAudit`. Verify: unit tests cover each helper and the audit before/after JSON.
- [x] 3. Implement `contentHash` (`src/ingest/hash.ts`) and a property test that it is deterministic and distinct for distinct byte arrays.
- [x] 4. Implement `normalizeImage` (`src/ingest/image.ts`) with EXIF rotation, 2048 px fit-inside, JPEG q88. Verify: a 12 MP rotated fixture is upright, orientation 1, and ≤ 2048 px; a 200 px image is not enlarged.
- [x] 5. Implement the decodability gate and typed errors (`src/ingest/errors.ts`): `TOO_LARGE`, `UNDECODABLE`, `UNSUPPORTED_FORMAT` (HEIC), `STORE_FAILED`. Verify: one test per code, including a HEIC magic-byte fixture.
- [x] 6. Implement `ingestFile` (`src/ingest/ingest.ts`) with the transaction order in the design: hash → insert-or-existing → write file `wx` → audit → return. Verify: duplicate upload returns the same id, one row, one `duplicate_ingest` audit.
- [ ] 7. Implement the admin upload route (`src/app/api/admin/ingest/route.ts`): auth check, content-length gate, multipart parse, `zod` validation, map errors to status codes. Verify: route-level tests call the handler directly with a `Request`.
- [ ] 8. Add the admin upload form (`src/app/admin/page.tsx`): drag-and-drop and file picker, per-file result list, announced via `aria-live`. Verify: Playwright uploads two files and sees two queued rows.
- [ ] 9. Add the startup guard that creates `$REVENANT_DATA_DIR` and `uploads/` if absent, and fails loudly if the directory is not writable. Verify: unit test with a read-only temp directory.
- [ ] 10. Record the ingest convention in `.kiro/steering/archive-conventions.md` if any detail changed during implementation, and update this task list.
