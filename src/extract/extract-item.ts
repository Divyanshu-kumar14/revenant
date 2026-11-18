import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { rollbackQuietly } from "@/db/client";
import { getItem, insertExtraction, transitionItem, writeAudit } from "@/db/queries";
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
 * fixture; `EXTRACTOR=provider` or an unset value follows `VISION_PROVIDER` (default `nim`), whose
 * constructor raises `NO_KEY` or `CONFIG`. Every adapter setting is passed as an option, so this
 * function is the only place the environment is read. Never fetches.
 */
export function createExtractor(env: NodeJS.ProcessEnv): Extractor {
  const extractor = env.EXTRACTOR?.trim() ?? "";
  if (extractor === "fixture") return new FixtureExtractor();
  if (extractor !== "" && extractor !== "provider") {
    throw new ExtractionError(
      "CONFIG",
      `EXTRACTOR=${extractor} is not supported; use fixture or provider`,
    );
  }
  const provider = env.VISION_PROVIDER?.trim().toLowerCase() || "nim";
  if (provider === "nim") {
    return new NimExtractor({
      // resolveNimKey returns "" when absent, which is not nullish: the constructor cannot fall
      // back to process.env and report a key the caller never passed.
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
      model: env.VISION_MODEL || undefined,
      baseUrl: env.VISION_BASE_URL || undefined,
    });
  }
  throw new ExtractionError("CONFIG", `VISION_PROVIDER=${provider} is not supported; use nim or gemini`);
}

/**
 * Extracts one claimed item and always reports an outcome: a success, a failure with its code, or
 * `not_claimed` when the item left `extracting` before the finish. Errors from reading the upload,
 * from the extractor and from the success-path transaction all reach `finishFailure`, which runs in
 * a transaction of its own, so no failure reaches review without a code.
 */
export async function extractClaimed(item: ClaimedItem, deps: ExtractDeps): Promise<ExtractOutcome> {
  try {
    return await extractOnce(item, deps);
  } catch (error) {
    return finishFailure(item, deps, error);
  }
}

/** The success path; any throw is mapped to a failure code by `extractClaimed`. */
async function extractOnce(item: ClaimedItem, deps: ExtractDeps): Promise<ExtractOutcome> {
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
    if (
      transitionItem(db, { id: item.id, from: "extracting", to: "needs_review", error: null, at }) === 0
    ) {
      db.exec("ROLLBACK");
      return { itemId: item.id, status: "not_claimed", current: getItem(db, item.id)?.status ?? null };
    }
    const extractionId = randomUUID();
    insertExtraction(db, {
      id: extractionId,
      itemId: item.id,
      model: extractor.model,
      promptVersion: extractor.promptVersion,
      rawJson: result.raw,
      latencyMs,
      createdAt: at,
    });
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
    rollbackQuietly(db);
    throw error;
  }
}

/** An `ExtractionError` code is stored as it is; anything else is `INTERNAL`. */
function failureCode(error: unknown): FailureCode {
  return error instanceof ExtractionError ? error.code : "INTERNAL";
}

/**
 * Move a failed item to `needs_review` with its code, in a transaction of its own: the success path
 * may have failed with one still open. Writes no `extractions` row and exactly one `extract_failed`
 * audit row. Never throws, so one failure cannot stop a batch; if this transaction also fails the
 * item stays `extracting` and the next run's stale requeue returns it to `queued`. Only the id, the
 * code and, for `INTERNAL`, the error name are logged: messages can carry provider bodies and paths.
 */
function finishFailure(item: ClaimedItem, deps: ExtractDeps, error: unknown): ExtractOutcome {
  const { db, actor } = deps;
  const code = failureCode(error);
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`extract ${item.id} failed: ${code}${code === "INTERNAL" ? ` (${name})` : ""}`);

  try {
    db.exec("BEGIN IMMEDIATE");
    if (
      transitionItem(db, { id: item.id, from: "extracting", to: "needs_review", error: code, at }) === 0
    ) {
      db.exec("ROLLBACK");
      return { itemId: item.id, status: "not_claimed", current: getItem(db, item.id)?.status ?? null };
    }
    writeAudit(db, {
      itemId: item.id,
      actor,
      action: "extract_failed",
      before: { status: "extracting" },
      after: { status: "needs_review", error: code },
      at,
    });
    db.exec("COMMIT");
    return { itemId: item.id, status: "failed", code };
  } catch (finishError) {
    rollbackQuietly(db);
    const finishName = finishError instanceof Error ? finishError.name : typeof finishError;
    console.error(`extract ${item.id} failure finish failed: ${finishName}; left to the stale requeue`);
    return { itemId: item.id, status: "failed", code };
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
