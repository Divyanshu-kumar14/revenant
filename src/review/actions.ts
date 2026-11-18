/**
 * `reviewItem`, the only entry point that changes an item's review state.
 *
 * Synchronous on purpose: node:sqlite is synchronous, so a Promise would only pretend otherwise,
 * and a synchronous body keeps "one transaction" readable. The task 7 server action awaits it.
 *
 * Not a server action ("use server" would allow only async exports and no db parameter) and not
 * an authorization point: the caller passes `actor` from a verified session.
 *
 * One frame for all four actions: `reviewItem` validates, then `inTransaction` runs
 * getItem, targetStatus, getRecord, the status transition guarded by the status it read,
 * the action's own writes and one audit row.
 *
 * INVARIANT: `records.published_at IS NOT NULL` exactly when `items.status = 'published'`.
 * accept sets it, edit writes null, reject clears it, reopen touches no record row. The
 * audit table is the only place publication history survives.
 *
 * INVARIANT: no `await` may appear inside the transaction. `serverDb` shares one connection
 * across requests, so yielding mid-transaction lets another request open a nested one.
 *
 * Validation here is shape only. Title and date-display presence and date ordering are task 6,
 * which owns their field-level messages.
 */
import { z } from "zod";
import { rollbackQuietly } from "@/db/client";
import {
  clearItemEntities,
  getItem,
  getRecord,
  linkItemEntity,
  transitionItem,
  unpublishRecord,
  upsertEntity,
  upsertRecord,
  writeAudit,
} from "@/db/queries";
import type { EntityType, ItemStatus } from "@/db/types";
import { PRECISIONS, extractedEntitySchema, type ExtractedEntity } from "@/extract/provider";
import { displayName, nameKey } from "@/normalize/names";
import { ConcurrentChange, ItemNotFound, ReviewValidationError } from "./errors";
import { targetStatus, type ReviewAction } from "./state";

/** The database handle, typed from the query layer so only `src/db/` imports `node:sqlite`. */
export type ReviewDb = Parameters<typeof writeAudit>[0];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Length ceilings are structural guards against a runaway payload, not editorial rules.
export const reviewFieldsSchema = z.object({
  title: z.string().trim().max(500).nullable(),
  description: z.string().trim().max(20_000).nullable(),
  transcription: z.string().trim().max(50_000).nullable(),
  dateDisplay: z.string().trim().max(200).nullable(),
  dateStart: isoDate.nullable(),
  dateEnd: isoDate.nullable(),
  datePrecision: z.enum(PRECISIONS),
  people: z.array(extractedEntitySchema).max(50),
  places: z.array(extractedEntitySchema).max(50),
  subjects: z.array(extractedEntitySchema).max(20),
  confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
});

export type ReviewFields = z.infer<typeof reviewFieldsSchema>;

export interface ReviewDecision {
  itemId: string;
  action: ReviewAction;
  actor: string;
  fields?: ReviewFields;
}

export interface ReviewOutcome {
  status: ItemStatus;
}

/**
 * The facet (person, place, subject) lives in `entities.type`; `role` carries the relation
 * between item and entity, and "depicted" is the only one today. A single role is also what lets
 * the `(item_id, entity_id, role)` key dedupe a name the model listed twice.
 */
const ITEM_ENTITY_ROLE = "depicted";

/** Run `work` in one write transaction. BEGIN is outside the try: if it fails there is nothing to roll back. */
function inTransaction<T>(db: ReviewDb, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}

/** Apply one review decision in one transaction. Throws a typed error; never returns a failure. */
export function reviewItem(
  db: ReviewDb,
  decision: ReviewDecision,
  clock: () => Date = () => new Date(),
): ReviewOutcome {
  const { itemId, action, actor } = decision;
  if (actor.trim() === "") {
    throw new ReviewValidationError({ _form: "A review decision needs a reviewer." });
  }
  // Validate before BEGIN: a shape error must not take a write lock.
  let fields: ReviewFields | null = null;
  if (action === "accept" || action === "edit") {
    if (decision.fields === undefined) {
      throw new ReviewValidationError({ _form: `${action === "accept" ? "Accept" : "Edit"} needs the record fields.` });
    }
    fields = parseFields(decision.fields);
  }
  const at = clock().toISOString();

  return inTransaction(db, () => {
    const item = getItem(db, itemId);
    if (!item) throw new ItemNotFound(itemId);
    const to = targetStatus(action, item.status);
    const before = getRecord(db, itemId);

    // The read above is inside the write lock, so zero changes means the row moved underneath
    // this transaction. Report it; do not retry. Only accept clears the extraction error.
    const error = action === "accept" ? null : item.error;
    if (transitionItem(db, { id: itemId, from: item.status, to, error, at }) === 0) {
      throw new ConcurrentChange(itemId);
    }

    let entities: AuditEntities | undefined;
    if (fields !== null) {
      entities = writeRecord(db, itemId, fields, actor, action === "accept" ? at : null);
    } else if (action === "reject") {
      // Search maintenance lands with the archive read model (archive task 6), which creates
      // search_fts; until then reject has no search row to delete.
      unpublishRecord(db, itemId);
    }

    writeAudit(db, {
      itemId,
      actor,
      action,
      before: { status: item.status, record: before },
      after: {
        status: to,
        record: getRecord(db, itemId),
        ...(entities ? { entities } : {}),
      },
      at,
    });
    return { status: to };
  });
}

function parseFields(fields: unknown): ReviewFields {
  const parsed = reviewFieldsSchema.safeParse(fields);
  if (parsed.success) return parsed.data;
  const messages: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    messages[issue.path.join(".") || "_form"] = issue.message;
  }
  throw new ReviewValidationError(messages);
}

interface AuditEntities {
  people: string[];
  places: string[];
  subjects: string[];
}

/** Upsert the record and replace the item's entity links. `publishedAt` is null for edit. */
function writeRecord(
  db: ReviewDb,
  itemId: string,
  fields: ReviewFields,
  actor: string,
  publishedAt: string | null,
): AuditEntities {
  upsertRecord(db, {
    itemId,
    title: fields.title,
    description: fields.description,
    transcription: fields.transcription,
    dateStart: fields.dateStart,
    dateEnd: fields.dateEnd,
    dateDisplay: fields.dateDisplay,
    datePrecision: fields.datePrecision,
    confidenceJson: Object.keys(fields.confidence).length === 0 ? null : JSON.stringify(fields.confidence),
    reviewedBy: actor,
    publishedAt,
  });

  clearItemEntities(db, itemId);
  const groups: Array<[EntityType, ExtractedEntity[]]> = [
    ["person", fields.people],
    ["place", fields.places],
    ["subject", fields.subjects],
  ];
  for (const [type, entities] of groups) {
    for (const entity of entities) {
      const entityId = upsertEntity(db, { type, name: displayName(entity.name), nameKey: nameKey(entity.name) });
      linkItemEntity(db, { itemId, entityId, role: ITEM_ENTITY_ROLE, confidence: entity.confidence });
    }
  }
  return {
    people: fields.people.map((entity) => entity.name),
    places: fields.places.map((entity) => entity.name),
    subjects: fields.subjects.map((entity) => entity.name),
  };
}
