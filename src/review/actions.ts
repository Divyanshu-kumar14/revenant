/**
 * `reviewItem`, the only entry point that changes an item's review state.
 *
 * Synchronous on purpose: node:sqlite is synchronous, so a Promise would only pretend otherwise,
 * and a synchronous body keeps "one transaction" readable. The task 7 server action awaits it.
 *
 * Not a server action ("use server" would allow only async exports and no db parameter) and not
 * an authorization point: the caller passes `actor` from a verified session.
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

/** Apply one review decision in one transaction. Throws a typed error; never returns a failure. */
export function reviewItem(
  db: ReviewDb,
  decision: ReviewDecision,
  clock: () => Date = () => new Date(),
): ReviewOutcome {
  if (decision.actor.trim() === "") {
    throw new ReviewValidationError({ _form: "A published record needs a reviewer." });
  }
  switch (decision.action) {
    case "accept":
      return accept(db, decision, clock);
    case "edit":
    case "reject":
    case "reopen":
      throw new Error(`reviewItem: ${decision.action} is not implemented yet`);
  }
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

function accept(db: ReviewDb, decision: ReviewDecision, clock: () => Date): ReviewOutcome {
  if (decision.fields === undefined) {
    throw new ReviewValidationError({ _form: "Accept needs the record fields." });
  }
  const fields = parseFields(decision.fields);
  const { itemId, actor } = decision;
  const at = clock().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    const item = getItem(db, itemId);
    if (!item) throw new ItemNotFound(itemId);
    const to = targetStatus("accept", item.status);
    const before = getRecord(db, itemId);

    // The read above is inside the write lock, so zero changes means the row moved underneath
    // this transaction. Report it; do not retry.
    if (transitionItem(db, { id: itemId, from: item.status, to, error: null, at }) === 0) {
      throw new ConcurrentChange(itemId);
    }

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
      publishedAt: at,
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

    writeAudit(db, {
      itemId,
      actor,
      action: "accept",
      before: { status: item.status, record: before },
      after: {
        status: to,
        record: getRecord(db, itemId),
        entities: {
          people: fields.people.map((entity) => entity.name),
          places: fields.places.map((entity) => entity.name),
          subjects: fields.subjects.map((entity) => entity.name),
        },
      },
      at,
    });

    db.exec("COMMIT");
    return { status: to };
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}
