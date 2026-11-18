# Design — Ingest

## Context

An upload arrives as multipart form data from `/api/admin/ingest`. The request handler does three things and nothing else: authenticate, validate, delegate to `ingestFile()`. Everything that can corrupt the archive lives below that boundary.

## Components

```
app/api/admin/ingest/route.ts   auth, size gate, multipart parsing
src/ingest/ingest.ts            ingestFile(): the use case
src/ingest/image.ts             normalizeImage(): decode, rotate, resize, encode
src/ingest/hash.ts              contentHash(): sha256 of the stored bytes
src/db/queries.ts               insertItem, findItemBySha, writeAudit
src/db/client.ts                DatabaseSync, WAL, migrations
```

`src/app/**` never imports `sharp` or `node:sqlite`. `src/ingest/**` never imports a React or Next module.

## Interfaces

```ts
export interface IngestInput {
  fileName: string;          // original name, stored verbatim
  bytes: Buffer;             // raw upload, before normalisation
  caption?: string;
  actor?: string;            // defaults to "volunteer"
  now?: () => Date;          // injected for tests
}

export interface IngestResult {
  itemId: string;
  status: "queued" | "duplicate";
  sha256: string;
}

export function contentHash(bytes: Buffer): string;
export async function normalizeImage(bytes: Buffer): Promise<{
  bytes: Buffer;
  width: number;
  height: number;
  format: "jpeg";
}>;
export async function ingestFile(input: IngestInput): Promise<IngestResult>;
```

## Flow

1. Route handler rejects `Content-Length > 25 MB` before buffering.
2. `normalizeImage` calls `sharp(bytes, { failOn: "error" })`, `.rotate()`, `.resize(2048, 2048, { fit: "inside", withoutEnlargement: true })`, `.jpeg({ quality: 88, mozjpeg: true })`. Decode failure maps to `IngestError("UNDECODABLE")`.
3. `contentHash` hashes the normalised bytes, so the same photograph re-encoded by the same pipeline has one identity.
4. Inside a transaction: `INSERT INTO items (...) ON CONFLICT(sha256) DO NOTHING`. If `changes === 0`, select the existing row, write `duplicate_ingest` audit, return `duplicate`. If inserted, write the file to `uploads/<sha256>.jpg` with `flag: "wx"`, then commit. If the write fails, roll back and leave no row.
5. Return `queued`. No model call, no thumbnail generation, no geocoding on this path.

## Ordering and failure

The write happens inside the transaction on purpose: a row without a file is a lie. The `wx` flag makes a concurrent second writer fail rather than overwrite. If the process dies between file write and commit, the file is orphaned but the DB is clean; a startup sweep can delete unreferenced uploads (not required for v1, recorded as a follow-up).

| Failure | Result | Item state |
|---|---|---|
| Body over limit | `413` `TOO_LARGE` | none |
| Not decodable | `422` `UNDECODABLE` | none |
| HEIC/HEIF bytes | `422` `UNSUPPORTED_FORMAT`, message explains how to export as JPEG | none |
| Disk write fails | `500` `STORE_FAILED` | none (rolled back) |
| Duplicate hash | `200` `duplicate` | unchanged |
| Database locked | `503` `BUSY`, retry once after 50 ms | none |

## Security

- The route requires an admin session before parsing the body.
- `fileName` is metadata only; the stored path is derived from the hash, never from the name.
- MIME type is derived from decoded content, not the client header.
- HEIC/HEIF is rejected with an explanation rather than silently failing inside `sharp`.

## Testing

- Unit: `tests/unit/ingest.test.ts` with real small JPEG/PNG/TIFF buffers generated once into `tests/helpers/images.ts` (sharp at import time, no binary fixtures in git).
- Duplicate, EXIF rotation, 12 MP downscale, undecodable bytes, oversized input, and disk-write failure (inject a failing writer) each get a test.
- Property: `contentHash` is deterministic; normalising twice is idempotent for dimensions and orientation.
- E2E: upload through the real form in T7's flow.
