export type IngestErrorCode = "TOO_LARGE" | "UNDECODABLE" | "UNSUPPORTED_FORMAT" | "STORE_FAILED";

export class IngestError extends Error {
  constructor(
    readonly code: IngestErrorCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Throw TOO_LARGE when a declared or actual size exceeds the limit; call before buffering. */
export function checkSize(bytes: number, limit: number = MAX_UPLOAD_BYTES): void {
  if (bytes > limit) {
    throw new IngestError("TOO_LARGE", `File is ${bytes} bytes; the limit is ${limit} bytes.`);
  }
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx"]);
/** Box size (4) + "ftyp" (4) + major brand (4). */
const FTYP_MIN_BYTES = 12;

/**
 * Detect HEIC/HEIF from the leading ISO-BMFF `ftyp` box: magic bytes only, no decoding.
 * Returns "heic" when the major brand or any compatible brand is heic, heix, hevc or hevx.
 * Reads no further than the declared box size or the end of the buffer, whichever is first.
 */
export function sniffUnsupported(bytes: Uint8Array | Buffer): "heic" | null {
  if (bytes.length < FTYP_MIN_BYTES) return null;
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.toString("latin1", 4, 8) !== "ftyp") return null;
  const size = view.readUInt32BE(0);
  if (size < FTYP_MIN_BYTES) return null;
  const end = Math.min(size, view.length);
  // Offset 8 is the major brand, 12 the minor version, 16 onward the compatible brands.
  for (let offset = 8; offset + 4 <= end; offset += 4) {
    if (HEIF_BRANDS.has(view.toString("latin1", offset, offset + 4))) return "heic";
  }
  return null;
}
