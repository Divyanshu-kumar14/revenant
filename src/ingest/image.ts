import sharp from "sharp";
import { IngestError } from "./errors";

/**
 * Decoded-pixel cap. sharp's default (~268 MP) lets a 25 MiB file decode to hundreds of MB;
 * an A4 page scanned at 600 dpi is about 35 MP, so real flatbed scans still fit.
 */
const MAX_INPUT_PIXELS = 50_000_000;

export type NormalizedImage = { bytes: Buffer; width: number; height: number; format: "jpeg" };

/** Apply EXIF rotation, fit inside 2048x2048 without enlarging, re-encode as JPEG q88. */
export async function normalizeImage(bytes: Buffer): Promise<NormalizedImage> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height, format: "jpeg" };
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "unknown decode error";
    throw new IngestError("UNDECODABLE", `Image could not be decoded: ${detail}`);
  }
}
