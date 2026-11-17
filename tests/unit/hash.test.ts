import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { contentHash } from "@/ingest/hash";

describe("contentHash", () => {
  it("hashes empty input to the known sha256", () => {
    expect(contentHash(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("differs for distinct inputs", () => {
    expect(contentHash(Uint8Array.of(1))).not.toBe(contentHash(Uint8Array.of(2)));
  });

  it("is lowercase 64-char hex and Buffer/Uint8Array agree", () => {
    const b = Buffer.from("abc");
    expect(contentHash(b)).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(new Uint8Array(b))).toBe(contentHash(b));
  });

  it("is deterministic and equal for equal inputs", () => {
    fc.assert(
      fc.property(fc.uint8Array(), (a) => {
        const copy = Uint8Array.from(a);
        expect(contentHash(a)).toBe(contentHash(a));
        expect(contentHash(a)).toBe(contentHash(copy));
      }),
    );
  });

  it("gives distinct hashes for distinct inputs", () => {
    fc.assert(
      fc.property(fc.uint8Array(), fc.uint8Array(), (a, b) => {
        fc.pre(Buffer.compare(a, b) !== 0);
        expect(contentHash(a)).not.toBe(contentHash(b));
      }),
    );
  });
});
