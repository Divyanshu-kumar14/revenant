import { normalizeDate, type NormalizedDate } from "@/normalize/date";
import { displayName, nameKey } from "@/normalize/names";
import { FixtureExtractor } from "./fixture.ts";
import { NimExtractor, coerceExtraction, resolveNimKey } from "./nim.ts";
import { EXTRACTION_PROMPT, PROMPT_VERSION } from "./prompt.ts";
import {
  ExtractionError,
  GeminiExtractor,
  extractJsonObject,
  extractionSchema,
  type ExtractedEntity,
  type Extraction,
  type Extractor,
} from "./provider.ts";

export interface ProposedEntity {
  name: string;
  nameKey: string;
  confidence: number;
}

/** What review shows for one extraction. Derived from `raw_json` on every read, never stored. */
export interface Proposal {
  title: string | null;
  description: string | null;
  transcription: string | null;
  date: NormalizedDate;
  people: ProposedEntity[];
  places: ProposedEntity[];
  subjects: ProposedEntity[];
  /** The model's self-reported confidence, passed through unchanged. */
  confidence: Record<string, number>;
}

/**
 * Builds the extractor a run uses from the environment it is given. `EXTRACTOR=fixture` gives the
 * fixture; otherwise `VISION_PROVIDER` (default `nim`) picks the adapter, whose constructor raises
 * `NO_KEY` or `CONFIG`. Never fetches.
 */
export function createExtractor(env: NodeJS.ProcessEnv): Extractor {
  const extractor = env.EXTRACTOR?.trim() ?? "";
  if (extractor === "fixture") return new FixtureExtractor();
  if (extractor !== "") {
    throw new ExtractionError("CONFIG", `EXTRACTOR=${extractor} is not supported; use fixture or leave it unset`);
  }
  const provider = env.VISION_PROVIDER?.trim().toLowerCase() || "nim";
  if (provider === "nim") {
    return new NimExtractor({
      apiKey: resolveNimKey(env),
      model: env.NIM_MODEL,
      baseUrl: env.VISION_BASE_URL,
    });
  }
  if (provider === "gemini") {
    return new GeminiExtractor({
      apiKey: env.GEMINI_API_KEY || env.VISION_API_KEY || "",
      prompt: EXTRACTION_PROMPT,
      promptVersion: PROMPT_VERSION,
      model: env.GEMINI_MODEL || undefined,
      baseUrl: env.GEMINI_BASE_URL || undefined,
    });
  }
  throw new ExtractionError("CONFIG", `VISION_PROVIDER=${provider} is not supported; use nim or gemini`);
}

/**
 * The proposal for a stored raw response. Pure: the same `rawJson` and `now` give an equal
 * proposal. Throws when the text is neither valid nor salvageable, because only something other
 * than an adapter could have stored it, and an empty proposal would hide that.
 */
export function deriveProposal(rawJson: string, now?: Date): Proposal {
  let extraction: Extraction;
  let coerced = false;
  try {
    extraction = extractionSchema.parse(JSON.parse(extractJsonObject(rawJson)));
  } catch {
    // The same salvage NimExtractor applied when it accepted this text; rethrows if it cannot.
    extraction = coerceExtraction(rawJson);
    coerced = true;
  }

  // §3: a salvaged date is unknown, and its text is never parsed into a date.
  const date: NormalizedDate = coerced
    ? { display: extraction.date.display ?? null, start: null, end: null, precision: "unknown", ambiguous: false }
    : normalizeDate(extraction.date.display, extraction.date, now);

  return {
    title: extraction.title,
    description: extraction.description,
    transcription: extraction.transcription,
    date,
    people: proposeEntities(extraction.people),
    places: proposeEntities(extraction.places),
    subjects: proposeEntities(extraction.subjects),
    confidence: extraction.confidence,
  };
}

/** Normalises names and drops exact key duplicates, keeping the higher confidence (first on a tie). */
function proposeEntities(entities: ExtractedEntity[]): ProposedEntity[] {
  const byKey = new Map<string, ProposedEntity>();
  for (const entity of entities) {
    const name = displayName(entity.name);
    const key = nameKey(name);
    const kept = byKey.get(key);
    if (!kept || entity.confidence > kept.confidence) {
      byKey.set(key, { name, nameKey: key, confidence: entity.confidence });
    }
  }
  return [...byKey.values()];
}
