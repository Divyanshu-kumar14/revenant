import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getItem, writeAudit } from "@/db/queries";
import type { ItemStatus } from "@/db/types";
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
  type ExtractionErrorCode,
  type Extractor,
} from "./provider.ts";

/** The database handle, typed from the query layer so only `src/db/` imports `node:sqlite`. */
export type ExtractDb = Parameters<typeof writeAudit>[0];

/** An item `claim()` moved to `extracting`. `storedPath` is relative to the data directory. */
export interface ClaimedItem {
  id: string;
  storedPath: string;
}

export type FailureCode = ExtractionErrorCode | "INTERNAL";

export type ExtractOutcome =
  | { itemId: string; status: "extracted"; extractionId: string; model: string; promptVersion: string; latencyMs: number }
  | { itemId: string; status: "failed"; code: FailureCode }
  | { itemId: string; status: "not_claimed"; current: ItemStatus | null };

export interface ExtractDeps {
  db: ExtractDb;
  dataDir: string;
  extractor: Extractor;
  /** "cli" for the script, the session actor for the route. */
  actor: string;
  /** Injected for tests; defaults to the system clock. */
  now?: () => Date;
}

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
 * Extracts one claimed item: reads its upload, calls the model with no transaction open, then
 * finishes in one `BEGIN IMMEDIATE` transaction that writes the `extractions` row, moves the item
 * to `needs_review` and writes the `extract` audit row. If the item is no longer `extracting` at
 * the finish, nothing is written and the outcome is `not_claimed`. Errors from reading the file
 * or from the extractor propagate unchanged; mapping them to a failure code is the caller's job.
 */
export async function extractClaimed(item: ClaimedItem, deps: ExtractDeps): Promise<ExtractOutcome> {
  const { db, extractor, actor } = deps;
  const clock = deps.now ?? (() => new Date());
  const image = await readFile(join(deps.dataDir, item.storedPath));

  const started = clock();
  const result = await extractor.extract({ image, mimeType: "image/jpeg" });
  const finished = clock();
  const latencyMs = finished.getTime() - started.getTime();
  const at = finished.toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    const moved = db
      .prepare(
        "UPDATE items SET status = 'needs_review', error = NULL, updated_at = ? WHERE id = ? AND status = 'extracting'",
      )
      .run(at, item.id);
    if (Number(moved.changes) === 0) {
      db.exec("ROLLBACK");
      return { itemId: item.id, status: "not_claimed", current: getItem(db, item.id)?.status ?? null };
    }
    const extractionId = randomUUID();
    db.prepare(
      `INSERT INTO extractions (id, item_id, model, prompt_version, raw_json, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(extractionId, item.id, extractor.model, extractor.promptVersion, result.raw, latencyMs, at);
    writeAudit(db, {
      itemId: item.id,
      actor,
      action: "extract",
      before: { status: "extracting" },
      after: {
        status: "needs_review",
        extractionId,
        model: extractor.model,
        promptVersion: extractor.promptVersion,
        latencyMs,
        repaired: result.repaired,
        coerced: result.coerced,
      },
      at,
    });
    db.exec("COMMIT");
    return {
      itemId: item.id,
      status: "extracted",
      extractionId,
      model: extractor.model,
      promptVersion: extractor.promptVersion,
      latencyMs,
    };
  } catch (error) {
    rollback(db);
    throw error;
  }
}

/**
 * Roll back if a transaction is still open. A failing ROLLBACK is ignored so the caller's
 * original error is the one that propagates.
 */
export function rollback(db: ExtractDb): void {
  try {
    if (db.isTransaction) db.exec("ROLLBACK");
  } catch {
    // Ignored on purpose: the original error is more useful than the rollback's.
  }
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
