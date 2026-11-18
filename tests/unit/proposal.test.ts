import { describe, expect, it } from "vitest";
import { createExtractor, deriveProposal } from "@/extract/extract-item";
import { FixtureExtractor } from "@/extract/fixture";
import { NimExtractor } from "@/extract/nim";
import { ExtractionError, GeminiExtractor, type Extractor } from "@/extract/provider";

const NOW = new Date("2026-11-18T12:00:00Z");
const input = { image: Buffer.from("not-a-real-jpeg"), mimeType: "image/jpeg" };

/** An explicit environment; process.env is never read or mutated. */
function env(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars };
}

function raw(fields: Record<string, unknown>): string {
  return JSON.stringify({
    transcription: null,
    title: "Test item",
    description: null,
    date: { display: null, start: null, end: null, precision: "unknown" },
    people: [],
    places: [],
    subjects: [],
    confidence: { date: 0.5 },
    ...fields,
  });
}

async function fixtureRaw() {
  const extractor: Extractor = new FixtureExtractor();
  return extractor.extract(input);
}

function codeOf(build: () => unknown): string | undefined {
  try {
    build();
  } catch (error) {
    return error instanceof ExtractionError ? error.code : `not an ExtractionError: ${String(error)}`;
  }
  return undefined;
}

describe("deriveProposal", () => {
  it("derives the fixture's record with its confidence unchanged", async () => {
    const result = await fixtureRaw();
    const proposal = deriveProposal(result.raw, NOW);
    expect(proposal.title).toBe("Fixture: mill pond at first light");
    expect(proposal.date).toEqual({
      display: "June 14, 1911",
      start: "1911-06-14",
      end: "1911-06-14",
      precision: "day",
      ambiguous: false,
    });
    expect(proposal.confidence).toEqual(result.extraction.confidence);
  });

  it("keeps a valid structured date over a two-digit display and flags the disagreement", () => {
    const proposal = deriveProposal(
      raw({ date: { display: "3-2-10", start: "1910-03-02", end: "1910-03-02", precision: "day" } }),
      NOW,
    );
    expect(proposal.date.display).toBe("March 2, 1910");
    expect(proposal.date.start).toBe("1910-03-02");
    expect(proposal.date.ambiguous).toBe(true);
    expect(proposal.date.start?.startsWith("2010")).toBe(false);
  });

  it("never turns a salvaged date into a date", () => {
    const proposal = deriveProposal(
      raw({ date: { display: "March 1910", start: null, end: null, precision: "sometime" }, people: null }),
      NOW,
    );
    expect(proposal.date.precision).toBe("unknown");
    expect(proposal.date.start).toBeNull();
    expect(proposal.date.end).toBeNull();
    expect(proposal.date.display).toBe("March 1910");
    expect(proposal.confidence.date).toBe(0);
    expect(proposal.people).toEqual([]);
  });

  it("parses a fenced response with prose before the fence", () => {
    const text = `Here is the record you asked for.\n\`\`\`json\n${raw({ title: "Fenced item" })}\n\`\`\`\n`;
    expect(deriveProposal(text, NOW).title).toBe("Fenced item");
  });

  it("collapses names whose keys match, keeping the higher confidence", () => {
    const proposal = deriveProposal(
      raw({
        people: [
          { name: "O'Brien", confidence: 0.4 },
          { name: "O\u2019Brien", confidence: 0.8 },
        ],
      }),
      NOW,
    );
    expect(proposal.people).toHaveLength(1);
    expect(proposal.people[0]?.confidence).toBe(0.8);
    expect(proposal.people[0]?.nameKey).toBe("o'brien");
  });

  it("normalises names without merging initials into full names", () => {
    const proposal = deriveProposal(
      raw({
        people: [
          { name: "  J.  Smith ", confidence: 0.6 },
          { name: "John Smith", confidence: 0.6 },
        ],
      }),
      NOW,
    );
    expect(proposal.people.map((person) => person.name)).toEqual(["J. Smith", "John Smith"]);
    expect(proposal.people[0]?.nameKey).not.toBe(proposal.people[1]?.nameKey);
  });

  it("throws on a raw response no adapter could have accepted", () => {
    // Not {"nope":1}: coerceExtraction salvages any object whose only faults are the date and lists.
    expect(() => deriveProposal(raw({ title: 5 }), NOW)).toThrow();
    expect(() => deriveProposal("no JSON here", NOW)).toThrow();
  });
});

describe("createExtractor", () => {
  it("returns the fixture for EXTRACTOR=fixture", () => {
    expect(createExtractor(env({ EXTRACTOR: " fixture " }))).toBeInstanceOf(FixtureExtractor);
  });

  it("rejects an unknown EXTRACTOR with CONFIG", () => {
    expect(codeOf(() => createExtractor(env({ EXTRACTOR: "bogus", NVIDIA_API_KEY: "dummy" })))).toBe("CONFIG");
  });

  it("treats EXTRACTOR=provider as the provider path, not as an error", () => {
    expect(
      createExtractor(env({ EXTRACTOR: "provider", NVIDIA_API_KEY: "dummy" })),
    ).toBeInstanceOf(NimExtractor);
  });

  it("treats a blank EXTRACTOR as absent", () => {
    expect(createExtractor(env({ EXTRACTOR: "  ", NVIDIA_API_KEY: "dummy" }))).toBeInstanceOf(NimExtractor);
  });

  it("defaults to NIM", () => {
    expect(createExtractor(env({ NVIDIA_API_KEY: "dummy" }))).toBeInstanceOf(NimExtractor);
  });

  it("reads the Gemini model from VISION_MODEL, the name .env.example uses", () => {
    const extractor = createExtractor(
      env({ VISION_PROVIDER: "gemini", GEMINI_API_KEY: "dummy", VISION_MODEL: "vision-model-x" }),
    );
    expect(extractor.model).toBe("vision-model-x");
  });

  it("builds Gemini when asked", () => {
    expect(createExtractor(env({ VISION_PROVIDER: " Gemini ", GEMINI_API_KEY: "dummy" }))).toBeInstanceOf(
      GeminiExtractor,
    );
  });

  it("raises NO_KEY for NIM without a key", () => {
    expect(codeOf(() => createExtractor(env({ VISION_PROVIDER: "nim" })))).toBe("NO_KEY");
  });

  it("refuses to send a NIM key to Google", () => {
    expect(
      codeOf(() =>
        createExtractor(env({
          NVIDIA_API_KEY: "dummy",
          VISION_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
        })),
      ),
    ).toBe("CONFIG");
  });

  it("ignores process.env.NIM_MODEL, so a shell setting cannot change the model", () => {
    const before = process.env.NIM_MODEL;
    process.env.NIM_MODEL = "leak-model";
    try {
      expect(createExtractor(env({ NVIDIA_API_KEY: "dummy" })).model).not.toBe("leak-model");
    } finally {
      if (before === undefined) delete process.env.NIM_MODEL;
      else process.env.NIM_MODEL = before;
    }
  });

  it("ignores process.env.NVIDIA_API_KEY, so a shell key cannot satisfy an empty env", () => {
    const before = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = "leaked-key";
    try {
      expect(codeOf(() => createExtractor(env({})))).toBe("NO_KEY");
    } finally {
      if (before === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = before;
    }
  });

  it("ignores process.env.VISION_BASE_URL, so a shell endpoint cannot trip the Google guard", () => {
    const before = process.env.VISION_BASE_URL;
    process.env.VISION_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
    try {
      expect(createExtractor(env({ NVIDIA_API_KEY: "dummy" }))).toBeInstanceOf(NimExtractor);
    } finally {
      if (before === undefined) delete process.env.VISION_BASE_URL;
      else process.env.VISION_BASE_URL = before;
    }
  });
});
