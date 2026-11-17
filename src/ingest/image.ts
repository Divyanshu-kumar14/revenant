import sharp from "sharp";

export class IngestError extends Error {
  constructor(
    readonly code: "UNDECODABLE",
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export type NormalizedImage = { bytes: Buffer; width: number; height: number; format: "jpeg" };

/** Apply EXIF rotation, fit inside 2048x2048 without enlarging, re-encode as JPEG q88. */
export async function normalizeImage(bytes: Buffer): Promise<NormalizedImage> {
  try {
    const { data, info } = await sharp(bytes, { failOn: "error" })
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
