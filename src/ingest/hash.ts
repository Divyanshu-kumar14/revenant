import { createHash } from "node:crypto";

/** Lowercase hex sha256 (64 chars) of the given bytes; the format findItemBySha expects. */
export function contentHash(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
