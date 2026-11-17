import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findItemBySha, insertItem, writeAudit } from "@/db/queries";
import { IngestError, checkSize, sniffUnsupported } from "./errors";
import { contentHash } from "./hash";
import { normalizeImage } from "./image";

export interface IngestInput {
  /** Original name, stored verbatim as metadata. Never used to build a path. */
  fileName: string;
  /** Raw upload, before normalisation. */
  bytes: Buffer;
  caption?: string;
  /** Defaults to "volunteer". */
  actor?: string;
  /** ISO 8601 UTC timestamp source; injected for tests. */
  now?: () => string;
}

export interface IngestResult {
  itemId: string;
  status: "queued" | "duplicate";
  sha256: string;
}

/** The database handle the query helpers accept; src/db owns the node:sqlite import. */
export type IngestDb = Parameters<typeof insertItem>[0];

export interface IngestDeps {
  db: IngestDb;
  /** Root of the data directory; files go to `<dataDir>/uploads/<sha256>.jpg`. */
  dataDir: string;
}

const HEIC_MESSAGE =
  "HEIC photos cannot be read yet. Export the photo as JPEG (on an iPhone: Settings > Camera > Formats > Most Compatible) and upload it again.";

/**
 * Size gate → HEIC sniff → normalise → hash the normalised bytes → one transaction:
 * existing item ⇒ duplicate_ingest audit; otherwise insert, write the file with `wx`, audit, commit.
 * Any failure inside the transaction rolls back, so no row exists without its file.
 */
export async function ingestFile(input: IngestInput, deps: IngestDeps): Promise<IngestResult> {
  checkSize(input.bytes.length);
  if (sniffUnsupported(input.bytes) === "heic") {
    throw new IngestError("UNSUPPORTED_FORMAT", HEIC_MESSAGE);
  }
  const image = await normalizeImage(input.bytes);
  const sha256 = contentHash(image.bytes);

  const actor = input.actor ?? "volunteer";
  const now = input.now ?? (() => new Date().toISOString());
  const storedPath = `uploads/${sha256}.jpg`;
  const absolutePath = join(deps.dataDir, storedPath);
  const { db } = deps;

  // Everything from BEGIN to COMMIT is synchronous, so no other statement on this
  // connection can interleave. IMMEDIATE takes the write lock up front, which makes
  // the existence check and the insert atomic against other connections.
  db.exec("BEGIN IMMEDIATE");
  let fileWritten = false;
  try {
    const existing = findItemBySha(db, sha256);
    if (existing) {
      writeAudit(db, {
        itemId: existing.id,
        actor,
        action: "duplicate_ingest",
        before: null,
        after: { fileName: input.fileName },
        at: now(),
      });
      db.exec("COMMIT");
      return { itemId: existing.id, status: "duplicate", sha256 };
    }

    const at = now();
    const item = insertItem(db, {
      id: randomUUID(),
      sha256,
      fileName: input.fileName,
      storedPath,
      caption: input.caption ?? null,
      now: at,
    });
    writeUpload(absolutePath, image.bytes);
    fileWritten = true;
    writeAudit(db, {
      itemId: item.id,
      actor,
      action: "ingest",
      before: null,
      after: { status: "queued", sha256, width: image.width, height: image.height },
      at,
    });
    db.exec("COMMIT");
    return { itemId: item.id, status: "queued", sha256 };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    if (fileWritten) {
      const leftover = discard(absolutePath);
      if (leftover) {
        throw new IngestError(
          "STORE_FAILED",
          "The upload was not saved, and a partial file could not be removed.",
          `${storedPath}: ${leftover}`,
        );
      }
    }
    throw error;
  }
}

/** `wx` fails instead of overwriting when the file already exists. */
function writeUpload(path: string, bytes: Buffer): void {
  try {
    writeFileSync(path, bytes, { flag: "wx" });
  } catch (cause) {
    throw new IngestError("STORE_FAILED", "The upload could not be saved to disk.", errorCode(cause));
  }
}

/** Remove a file written by a rolled-back ingest. Returns an error code if removal failed. */
function discard(path: string): string | null {
  try {
    rmSync(path, { force: true });
    return null;
  } catch (cause) {
    return errorCode(cause);
  }
}

function errorCode(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ?? cause.message;
  }
  return "unknown error";
}
