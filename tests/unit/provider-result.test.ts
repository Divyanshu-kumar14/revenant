import { describe, expect, it } from "vitest";
import { NimExtractor } from "@/extract/nim";
import { ExtractionError, GeminiExtractor, type Extractor } from "@/extract/provider";

const input = { image: Buffer.from("not-a-real-jpeg"), mimeType: "image/jpeg" };

/** A valid response, pretty-printed and fenced, so a re-serialisation could never equal it. */
const FENCED_VALID = [
  "```json",
  "{",
  '  "transcription": "WACHUSETT DAM",',
  '  "title":   "Wachusett Dam",',
  '  "description": null,',
  '  "date": { "display": "Aug. 25, 1909", "start": "1909-08-25", "end": "1909-08-25", "precision": "day" },',
  '  "people": [],',
  '  "places": [ { "name": "Clinton", "confidence": 0.9 } ],',
  '  "subjects": [],',
  '  "confidence": { "date": 0.8 }',
  "}",
  "```",
].join("\n");

/** Valid, unfenced, with its own spacing. */
const PLAIN_VALID =
  '{"transcription":null, "title":"Main Street","description":null,' +
  '"date":{"display":"1912","start":"1912-01-01","end":"1912-12-31","precision":"year"},' +
  '"people":[],"places":[],"subjects":[],"confidence":{"date":0.6}}';

/** Fails validation on the date precision only: the shape NimExtractor salvages. */
const BAD_PRECISION =
  'Here is the corrected object:\n{"transcription":"WACHUSETT DAM","title":"Wachusett Dam","description":null,' +
  '"date":{"display":"Aug. 25, 1909","start":"1909-08-25","end":"1909-08-25","precision":"exact day"},' +
  '"people":[],"places":[{"name":"Clinton","confidence":0.9}],"subjects":[],"confidence":{"date":0.9}}';

/** Fails validation on content, which no adapter salvages. */
const BAD_CONTENT =
  '{"transcription":null,"title":null,"description":null,' +
  '"date":{"display":null,"start":null,"end":null,"precision":"unknown"},' +
  '"people":[],"places":[{"name":"","confidence":2}],"subjects":[],"confidence":{}}';

const NOT_JSON = "I could not read this photograph.";

/** Each call returns the next text in order, wrapped in the provider's response envelope. */
function scripted(envelope: (text: string) => unknown, texts: string[]) {
  const state = { calls: 0 };
  const fetchImpl = (async () => {
    const text = texts[Math.min(state.calls, texts.length - 1)];
    state.calls += 1;
    return new Response(JSON.stringify(envelope(text)), { status: 200 });
  }) as typeof fetch;
  return { state, fetchImpl };
}

const adapters: Array<{ name: string; make: (texts: string[]) => { state: { calls: number }; extractor: Extractor } }> = [
  {
    name: "GeminiExtractor",
    make: (texts) => {
      const { state, fetchImpl } = scripted((text) => ({ candidates: [{ content: { parts: [{ text }] } }] }), texts);
      return { state, extractor: new GeminiExtractor({ apiKey: "k", prompt: "p", promptVersion: "v1", fetchImpl }) };
    },
  },
  {
    name: "NimExtractor",
    make: (texts) => {
      const { state, fetchImpl } = scripted((text) => ({ choices: [{ message: { content: text } }] }), texts);
      return { state, extractor: new NimExtractor({ apiKey: "k", baseUrl: "https://nim.test/v1", fetchImpl }) };
    },
  },
];

describe.each(adapters)("$name result", ({ make }) => {
  it("returns the first response verbatim, fence and formatting included, on a first-try success", async () => {
    const { state, extractor } = make([FENCED_VALID]);
    const result = await extractor.extract(input);
    expect(result.raw).toBe(FENCED_VALID);
    expect(result.raw).not.toBe(JSON.stringify(result.extraction));
    expect(result).toMatchObject({ repaired: false, coerced: false });
    expect(result.extraction.title).toBe("Wachusett Dam");
    expect(state.calls).toBe(1);
  });

  it("returns the repair response verbatim when the first response is invalid", async () => {
    const { state, extractor } = make([NOT_JSON, PLAIN_VALID]);
    const result = await extractor.extract(input);
    expect(result.raw).toBe(PLAIN_VALID);
    expect(result).toMatchObject({ repaired: true, coerced: false });
    expect(result.extraction.date.precision).toBe("year");
    expect(state.calls).toBe(2);
  });

  it("throws SCHEMA and returns no result when both responses fail on content", async () => {
    const { state, extractor } = make([NOT_JSON, BAD_CONTENT]);
    const error = await extractor.extract(input).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toMatchObject({ code: "SCHEMA" });
    expect(state.calls).toBe(2);
  });
});

describe("NimExtractor coercion result", () => {
  it("returns the repair response verbatim with repaired and coerced when the salvage runs", async () => {
    const { make } = adapters[1];
    const { state, extractor } = make([NOT_JSON, BAD_PRECISION]);
    const result = await extractor.extract(input);
    expect(result.raw).toBe(BAD_PRECISION);
    expect(result).toMatchObject({ repaired: true, coerced: true });
    expect(result.extraction.date.precision).toBe("unknown");
    expect(result.extraction.confidence.date).toBe(0);
    expect(result.extraction.transcription).toBe("WACHUSETT DAM");
    expect(state.calls).toBe(2);
  });
});

describe("GeminiExtractor does not salvage", () => {
  it("throws SCHEMA for the date fault NimExtractor would coerce", async () => {
    const { make } = adapters[0];
    const { extractor } = make([NOT_JSON, BAD_PRECISION]);
    await expect(extractor.extract(input)).rejects.toMatchObject({ name: "ExtractionError", code: "SCHEMA" });
  });
});
