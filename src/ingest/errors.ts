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

const HEIC_MARKERS = ["ftypheic", "ftypheix", "ftyphevc"];

/** Detect HEIC from ISO-BMFF ftyp brand magic bytes in the first 32 bytes. No decoding. */
export function sniffUnsupported(bytes: Uint8Array | Buffer): "heic" | null {
  const head = Buffer.from(bytes.subarray(0, 32)).toString("latin1");
  return HEIC_MARKERS.some((marker) => head.includes(marker)) ? "heic" : null;
}
