import { describe, expect, it } from "vitest";

import { NimExtractor } from "@/extract/nim";
import { ExtractionError } from "@/extract/provider";

const image = { image: Buffer.from("not-a-real-jpeg"), mimeType: "image/jpeg" };

/** Stubbed fetch: every call returns the same chat completion, and calls are counted. */
function stub(content: unknown) {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    state.calls += 1;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  return { state, extractor: new NimExtractor({ apiKey: "test-key", fetchImpl }) };
}

const base = {
  transcription: "WACHUSETT DAM",
  title: "Wachusett Dam",
  description: null,
  people: [],
  places: [{ name: "Clinton", confidence: 0.9 }],
  subjects: [],
  confidence: { date: 0.9 },
};

describe("NimExtractor date coercion", () => {
  it("coerces an unparsable precision (spike-124931365 shape) to unknown with confidence.date 0", async () => {
    const { state, extractor } = stub({
      ...base,
      date: { display: "Aug. 25, 1909", start: "1909-08-25", end: "1909-08-25", precision: "exact day" },
    });

    const { extraction: result, repaired, coerced } = await extractor.extract(image);

    expect(repaired).toBe(true);
    expect(coerced).toBe(true);
    expect(result.date).toEqual({
      display: "Aug. 25, 1909",
      start: null,
      end: null,
      precision: "unknown",
    });
    expect(result.confidence.date).toBe(0);
    expect(result.transcription).toBe("WACHUSETT DAM");
    // First call plus the repair call: coercion happens only after repair fails.
    expect(state.calls).toBe(2);
  });

  it("coerces a missing date and null entity lists, leaving other content intact", async () => {
    const { extractor } = stub({
      ...base,
      date: undefined,
      people: null,
      subjects: undefined,
    });

    const { extraction: result, repaired, coerced } = await extractor.extract(image);

    expect(repaired).toBe(true);
    expect(coerced).toBe(true);

    expect(result.date).toEqual({ display: null, start: null, end: null, precision: "unknown" });
    expect(result.confidence.date).toBe(0);
    expect(result.people).toEqual([]);
    expect(result.subjects).toEqual([]);
    expect(result.places).toEqual([{ name: "Clinton", confidence: 0.9 }]);
  });

  it("still throws SCHEMA when the fault is not the date", async () => {
    const { extractor } = stub({
      ...base,
      date: { display: null, start: null, end: null, precision: "year" },
      places: [{ name: "", confidence: 2 }],
    });

    await expect(extractor.extract(image)).rejects.toMatchObject({
      name: ExtractionError.name,
      code: "SCHEMA",
    });
  });
});
