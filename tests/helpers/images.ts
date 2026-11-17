import sharp from "sharp";

async function solidJpeg(width: number, height: number, orientation: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .jpeg({ quality: 80 })
    .withMetadata({ orientation })
    .toBuffer();
}

/** 12 MP (4000x3000 stored) JPEG with EXIF orientation 6, so it displays as 3000x4000. */
export const rotatedLarge = (): Promise<Buffer> => solidJpeg(4000, 3000, 6);

/** 200x200 JPEG, orientation 1. */
export const smallSquare = (): Promise<Buffer> => solidJpeg(200, 200, 1);

/** Bytes that are not an image. */
export const invalidBytes = (): Buffer => Buffer.from("this is not an image, just text");

/** A valid JPEG cut off partway through. */
export async function truncatedJpeg(): Promise<Buffer> {
  const full = await solidJpeg(1000, 1000, 1);
  return full.subarray(0, Math.floor(full.length / 2));
}
