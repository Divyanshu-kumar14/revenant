import { describe, expect, it } from "vitest";
import { IngestError, checkSize, sniffUnsupported } from "@/ingest/errors";
import { normalizeImage } from "@/ingest/image";
import { invalidBytes, smallSquare } from "../helpers/images";

const MiB = 1024 * 1024;

/**
 * ISO-BMFF ftyp box: 4-byte size, "ftyp", major brand, zero minor version, compatible brands.
 * `declaredSize` overrides the size field, to describe a box longer than the bytes present.
 */
function ftypBox(major: string, compatible: string[] = [], declaredSize?: number): Buffer {
  const length = 16 + 4 * compatible.length;
  const box = Buffer.alloc(length);
  box.writeUInt32BE(declaredSize ?? length, 0);
  box.write("ftyp", 4, "ascii");
  box.write(major, 8, "ascii");
  compatible.forEach((brand, i) => box.write(brand, 16 + 4 * i, "ascii"));
  return box;
}

describe("IngestError codes", () => {
  it("TOO_LARGE: checkSize throws over the 25 MiB default and passes at exactly the limit", () => {
    expect(() => checkSize(25 * MiB)).not.toThrow();
    expect(() => checkSize(25 * MiB + 1)).toThrow(IngestError);
    expect(() => checkSize(25 * MiB + 1)).toThrow(expect.objectContaining({ code: "TOO_LARGE" }));
    expect(() => checkSize(11, 10)).toThrow(expect.objectContaining({ code: "TOO_LARGE" }));
    expect(() => checkSize(10, 10)).not.toThrow();
  });

  it("UNDECODABLE: normalizeImage rejects non-image bytes with an IngestError instance", async () => {
    const err = await normalizeImage(invalidBytes()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err).toMatchObject({ code: "UNDECODABLE" });
  });

  it("UNSUPPORTED_FORMAT: sniffUnsupported detects HEIC brand boxes from magic bytes only", async () => {
    for (const brand of ["heic", "heix", "hevc"]) {
      expect(sniffUnsupported(ftypBox(brand))).toBe("heic");
    }
    expect(sniffUnsupported(await smallSquare())).toBeNull();
    expect(sniffUnsupported(ftypBox("isom"))).toBeNull();
    expect(sniffUnsupported(new Uint8Array(0))).toBeNull();
    const err = new IngestError("UNSUPPORTED_FORMAT", "HEIC is not supported");
    expect(err.code).toBe("UNSUPPORTED_FORMAT");
  });

  describe("sniffUnsupported reads the ftyp compatible brands", () => {
    it("detects heic in the compatible list behind a mif1 major brand", () => {
      expect(sniffUnsupported(ftypBox("mif1", ["mif1", "heic"]))).toBe("heic");
    });

    it("detects heic in the compatible list behind an msf1 major brand", () => {
      expect(sniffUnsupported(ftypBox("msf1", ["msf1", "iso8", "heic"]))).toBe("heic");
    });

    it("returns null for mif1 with no HEIF brand anywhere", () => {
      expect(sniffUnsupported(ftypBox("mif1", ["mif1", "miaf"]))).toBeNull();
    });

    it("returns null for an AVIF major brand", () => {
      expect(sniffUnsupported(ftypBox("avif", ["avif", "mif1", "miaf"]))).toBeNull();
    });

    it("finds a brand inside the available bytes when the declared size exceeds the buffer", () => {
      const box = ftypBox("mif1", ["heic"], 64);
      expect(box.length).toBeLessThan(64);
      expect(sniffUnsupported(box)).toBe("heic");
    });

    it("returns null for fewer than 12 bytes", () => {
      expect(sniffUnsupported(ftypBox("heic").subarray(0, 11))).toBeNull();
    });
  });

  it("STORE_FAILED: constructor passes code, message and detail through", () => {
    const err = new IngestError("STORE_FAILED", "Could not save the upload", "EACCES");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IngestError");
    expect(err.code).toBe("STORE_FAILED");
    expect(err.message).toBe("Could not save the upload");
    expect(err.detail).toBe("EACCES");
  });
});
