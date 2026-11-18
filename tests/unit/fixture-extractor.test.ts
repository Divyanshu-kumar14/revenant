import { describe, expect, it } from "vitest";
import { FixtureExtractor } from "@/extract/fixture";
import { extractionSchema, type Extractor } from "@/extract/provider";

const input = { image: Buffer.from("not-a-real-jpeg"), mimeType: "image/jpeg" };

/** Called through the interface, as the runner does; the class itself declares no parameter. */
const fixture = (): Extractor => new FixtureExtractor();

describe("FixtureExtractor", () => {
  it("resolves with raw text that parses to the returned extraction", async () => {
    const result = await fixture().extract(input);
    expect(JSON.parse(result.raw)).toEqual(result.extraction);
  });

  it("returns the same authored raw text on every call, never a re-serialisation", async () => {
    const extractor = fixture();
    const first = await extractor.extract(input);
    const second = await extractor.extract({ image: Buffer.from("other bytes"), mimeType: "image/png" });
    expect(second.raw).toBe(first.raw);
    expect(second).toEqual(first);
    expect(first.raw).not.toBe(JSON.stringify(first.extraction));
    expect(first.raw).toContain('\n  "title"');
  });

  it("reports neither repair nor coercion", async () => {
    const result = await fixture().extract(input);
    expect(result.repaired).toBe(false);
    expect(result.coerced).toBe(false);
  });

  it("names itself as the fixture model and prompt version", () => {
    const extractor = new FixtureExtractor();
    expect(extractor.model).toBe("fixture");
    expect(extractor.promptVersion).toBe("fixture");
  });

  it("produces raw text that passes the extraction schema", async () => {
    const result = await fixture().extract(input);
    expect(extractionSchema.safeParse(JSON.parse(result.raw)).success).toBe(true);
  });

  it("keeps a low-confidence person so review's low marking is exercised", async () => {
    const result = await fixture().extract(input);
    const ada = result.extraction.people.find((person) => person.name === "Ada Fixture");
    expect(ada).toBeDefined();
    expect(ada?.confidence).toBeLessThan(0.5);
  });
});
