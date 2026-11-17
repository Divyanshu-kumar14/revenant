import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeImage } from "@/ingest/image";
import { contentHash } from "@/ingest/hash";
import { invalidBytes, rotatedLarge, smallSquare, truncatedJpeg } from "../helpers/images";

describe("normalizeImage", () => {
  it("rotates upright, resets orientation, bounds the longest side, outputs jpeg", async () => {
    const out = await normalizeImage(await rotatedLarge());
    const meta = await sharp(out.bytes).metadata();
    expect(meta.orientation ?? 1).toBe(1);
    expect(meta.format).toBe("jpeg");
    expect(out.format).toBe("jpeg");
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2048);
    expect(out.width).toBe(meta.width);
    expect(out.height).toBe(meta.height);
    expect(out.height).toBeGreaterThan(out.width); // 3000x4000 after rotation
  });

  it("does not enlarge a small image", async () => {
    const out = await normalizeImage(await smallSquare());
    expect([out.width, out.height]).toEqual([200, 200]);
  });

  it("is deterministic for identical input", async () => {
    const input = await smallSquare();
    const a = await normalizeImage(input);
    const b = await normalizeImage(Buffer.from(input));
    expect(contentHash(a.bytes)).toBe(contentHash(b.bytes));
  });

  it("rejects non-image bytes with UNDECODABLE", async () => {
    await expect(normalizeImage(invalidBytes())).rejects.toMatchObject({ code: "UNDECODABLE" });
  });

  it("rejects truncated images with UNDECODABLE", async () => {
    await expect(normalizeImage(await truncatedJpeg())).rejects.toMatchObject({
      code: "UNDECODABLE",
    });
  });
});
