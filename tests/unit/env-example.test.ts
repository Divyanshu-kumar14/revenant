import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { describe, expect, it } from "vitest";
import { createExtractor } from "@/extract/extract-item";
import { NimExtractor } from "@/extract/nim";

const parsed = parseEnv(readFileSync(".env.example", "utf8"));

describe(".env.example", () => {
  it("selects the provider extractor and the NIM adapter", () => {
    expect(parsed.EXTRACTOR).toBe("provider");
    expect(parsed.VISION_PROVIDER).toBe("nim");
  });

  it("has no active VISION_BASE_URL pointing at Google", () => {
    expect(parsed.VISION_BASE_URL ?? "").not.toContain("googleapis.com");
  });

  it("builds a NimExtractor with only a key added", () => {
    const extractor = createExtractor({ NODE_ENV: "test", ...parsed, NVIDIA_API_KEY: "dummy" });

    expect(extractor).toBeInstanceOf(NimExtractor);
  });
});
