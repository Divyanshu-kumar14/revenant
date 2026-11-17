import { describe, expect, it } from "vitest";
import { IngestError, checkSize, sniffUnsupported } from "@/ingest/errors";
import { normalizeImage } from "@/ingest/image";
import { invalidBytes, smallSquare } from "../helpers/images";

const MiB = 1024 * 1024;

/** Minimal ISO-BMFF header: 4-byte box size, "ftyp", 4-byte major brand, minor version. */
function ftypBox(brand: string): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftyp", 4, "ascii");
  box.write(brand, 8, "ascii");
  box.write("mif1heic", 16, "ascii");
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

  it("STORE_FAILED: constructor passes code, message and detail through", () => {
    const err = new IngestError("STORE_FAILED", "Could not save the upload", "EACCES");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("IngestError");
    expect(err.code).toBe("STORE_FAILED");
    expect(err.message).toBe("Could not save the upload");
    expect(err.detail).toBe("EACCES");
  });
});
