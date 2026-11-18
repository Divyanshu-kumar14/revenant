import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { EntityType, ItemRow, ItemStatus, RecordRow } from "./types";
import type { Precision } from "@/extract/provider";

export interface NewItem {
  id: string;
  sha256: string;
  fileName: string;
  storedPath: string;
  caption?: string | null;
  /** ISO 8601 UTC. Defaults to the current time. */
  now?: string;
}

export interface AuditEvent {
  itemId: string;
  actor: string;
  action: string;
  before: unknown;
  after: unknown;
  /** ISO 8601 UTC. Defaults to the current time. */
  at?: string;
}

const TABLES = [
  "items",
  "extractions",
  "records",
  "entities",
  "item_entities",
  "places",
  "audit_events",
  "eval_runs",
] as const;

type TableName = (typeof TABLES)[number];

function isTable(name: string): name is TableName {
  return (TABLES as readonly string[]).includes(name);
}

/** Insert a queued item. A duplicate sha256 throws a UNIQUE constraint error. */
export function insertItem(db: DatabaseSync, item: NewItem): ItemRow {
  const now = item.now ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO items (id, sha256, file_name, stored_path, caption, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(item.id, item.sha256, item.fileName, item.storedPath, item.caption ?? null, now, now);
  const row = getItem(db, item.id);
  if (!row) throw new Error(`insertItem: item ${item.id} missing after insert`);
  return row;
}

export function findItemBySha(db: DatabaseSync, sha256: string): ItemRow | null {
  const row = db.prepare("SELECT * FROM items WHERE sha256 = ?").get(sha256);
  return (row as unknown as ItemRow | undefined) ?? null;
}

export function getItem(db: DatabaseSync, id: string): ItemRow | null {
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
  return (row as unknown as ItemRow | undefined) ?? null;
}

/** Count rows in one of the eight known tables. Any other name throws. */
export function countRows(db: DatabaseSync, table: string): number {
  if (!isTable(table)) throw new Error(`countRows: unknown table "${table}"`);
  // The name is checked against the allowlist above; identifiers cannot be bound as parameters.
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint };
  return Number(row.n);
}

/** Append one audit event. audit_events is append-only: there is no update or delete helper. */
export function writeAudit(db: DatabaseSync, event: AuditEvent): void {
  db.prepare(
    `INSERT INTO audit_events (id, item_id, actor, action, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    event.itemId,
    event.actor,
    event.action,
    event.before === undefined || event.before === null ? null : JSON.stringify(event.before),
    event.after === undefined || event.after === null ? null : JSON.stringify(event.after),
    event.at ?? new Date().toISOString(),
  );
}

/** The oldest queued item, or the named one when it is queued. Null when nothing is claimable. */
export function nextQueuedItem(
  db: DatabaseSync,
  itemId?: string,
): { id: string; storedPath: string } | null {
  const row = (
    itemId === undefined
      ? db
        .prepare("SELECT id, stored_path FROM items WHERE status = 'queued' ORDER BY created_at, id LIMIT 1")
        .get()
      : db.prepare("SELECT id, stored_path FROM items WHERE id = ? AND status = 'queued'").get(itemId)
  ) as { id: string; stored_path: string } | undefined;
  return row ? { id: row.id, storedPath: row.stored_path } : null;
}

/**
 * Move one item between statuses, guarded by its current status, and set `error` explicitly:
 * there is no way to omit it and inherit a stale code. Returns the changed-row count, so zero
 * means the item left `from` before this ran.
 */
export function transitionItem(
  db: DatabaseSync,
  change: { id: string; from: ItemStatus; to: ItemStatus; error: string | null; at: string },
): number {
  const result = db
    .prepare("UPDATE items SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?")
    .run(change.to, change.error, change.at, change.id, change.from);
  return Number(result.changes);
}

export interface NewExtraction {
  id: string;
  itemId: string;
  model: string;
  promptVersion: string;
  rawJson: string;
  latencyMs: number;
  createdAt: string;
}

/** Insert one extraction row. The caller owns the transaction. */
export function insertExtraction(db: DatabaseSync, row: NewExtraction): void {
  db.prepare(
    `INSERT INTO extractions (id, item_id, model, prompt_version, raw_json, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.itemId, row.model, row.promptVersion, row.rawJson, row.latencyMs, row.createdAt);
}

/** What the review screen needs from an item's newest extraction. */
export interface LatestExtraction {
  rawJson: string;
  model: string;
  promptVersion: string;
  createdAt: string;
}

/** The item's newest extraction (ties broken by insertion order), or null when it has none. */
export function getLatestExtraction(db: DatabaseSync, itemId: string): LatestExtraction | null {
  const row = db
    .prepare(
      `SELECT raw_json, model, prompt_version, created_at FROM extractions
       WHERE item_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(itemId) as
    | { raw_json: string; model: string; prompt_version: string; created_at: string }
    | undefined;
  return row
    ? { rawJson: row.raw_json, model: row.model, promptVersion: row.prompt_version, createdAt: row.created_at }
    : null;
}

export interface ItemEntityLink {
  type: EntityType;
  name: string;
  confidence: number | null;
}

/** The entities linked to an item, ordered by type then name. */
export function listItemEntities(db: DatabaseSync, itemId: string): ItemEntityLink[] {
  return db
    .prepare(
      `SELECT e.type AS type, e.name AS name, ie.confidence AS confidence
       FROM item_entities ie JOIN entities e ON e.id = ie.entity_id
       WHERE ie.item_id = ? ORDER BY e.type, e.name`,
    )
    .all(itemId) as unknown as ItemEntityLink[];
}

/** Ids of items awaiting review, oldest first. Drives "Item N of M" only. */
export function listNeedsReviewIds(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT id FROM items WHERE status = 'needs_review' ORDER BY created_at, id")
    .all() as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

/** Items still `extracting` with `updated_at` before `cutoff`, oldest first. Stale-claim recovery. */
export function staleExtractingItems(
  db: DatabaseSync,
  cutoff: string,
): Array<{ id: string; updatedAt: string }> {
  const rows = db
    .prepare("SELECT id, updated_at FROM items WHERE status = 'extracting' AND updated_at < ? ORDER BY updated_at, id")
    .all(cutoff) as Array<{ id: string; updated_at: string }>;
  return rows.map((row) => ({ id: row.id, updatedAt: row.updated_at }));
}

/** How many items currently hold one status. Used for the batch summary's remaining count. */
export function countItemsWithStatus(db: DatabaseSync, status: ItemStatus): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM items WHERE status = ?").get(status) as { n: number | bigint };
  return Number(row.n);
}

export interface NewRecord {
  itemId: string;
  title: string | null;
  description: string | null;
  transcription: string | null;
  dateStart: string | null;
  dateEnd: string | null;
  dateDisplay: string | null;
  datePrecision: Precision;
  confidenceJson: string | null;
  reviewedBy: string | null;
  publishedAt: string | null;
}

/**
 * Insert or overwrite the one record for an item. Every column is replaced on conflict, so a
 * re-accept after a reject overwrites rather than duplicating. The caller owns the transaction.
 */
export function upsertRecord(db: DatabaseSync, record: NewRecord): void {
  db.prepare(
    `INSERT INTO records (item_id, title, description, transcription, date_start, date_end, date_display,
                          date_precision, confidence_json, reviewed_by, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       transcription = excluded.transcription,
       date_start = excluded.date_start,
       date_end = excluded.date_end,
       date_display = excluded.date_display,
       date_precision = excluded.date_precision,
       confidence_json = excluded.confidence_json,
       reviewed_by = excluded.reviewed_by,
       published_at = excluded.published_at`,
  ).run(
    record.itemId,
    record.title,
    record.description,
    record.transcription,
    record.dateStart,
    record.dateEnd,
    record.dateDisplay,
    record.datePrecision,
    record.confidenceJson,
    record.reviewedBy,
    record.publishedAt,
  );
}

/**
 * Mark a record as no longer published. Zero rows changed is fine (a never-accepted item has no
 * record). Field values and `reviewed_by` stay: who produced the record is still true.
 */
export function unpublishRecord(db: DatabaseSync, itemId: string): void {
  db.prepare("UPDATE records SET published_at = NULL WHERE item_id = ?").run(itemId);
}
export function getRecord(db: DatabaseSync, itemId: string): RecordRow | null {
  const row = db.prepare("SELECT * FROM records WHERE item_id = ?").get(itemId);
  return (row as unknown as RecordRow | undefined) ?? null;
}

/**
 * The id of the entity with this `(type, nameKey)`, inserting it when new. First spelling wins:
 * an existing entity keeps its `name`, so a name written differently on item 40 does not rename
 * the entity item 2 already links to. The caller owns the transaction.
 */
export function upsertEntity(db: DatabaseSync, entity: { type: EntityType; name: string; nameKey: string }): string {
  db.prepare(
    "INSERT INTO entities (id, type, name, name_key) VALUES (?, ?, ?, ?) ON CONFLICT(type, name_key) DO NOTHING",
  ).run(randomUUID(), entity.type, entity.name, entity.nameKey);
  const row = db
    .prepare("SELECT id FROM entities WHERE type = ? AND name_key = ?")
    .get(entity.type, entity.nameKey) as { id: string } | undefined;
  if (!row) throw new Error(`upsertEntity: ${entity.type} entity missing after insert`);
  return row.id;
}

/**
 * Link an item to an entity in one role. The `(item_id, entity_id, role)` primary key dedupes a
 * name listed twice; the second link is ignored. The caller owns the transaction.
 */
export function linkItemEntity(
  db: DatabaseSync,
  link: { itemId: string; entityId: string; role: string; confidence: number | null },
): void {
  db.prepare(
    "INSERT INTO item_entities (item_id, entity_id, role, confidence) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
  ).run(link.itemId, link.entityId, link.role, link.confidence);
}

/** Remove every entity link for one item; the entities themselves stay. The caller owns the transaction. */
export function clearItemEntities(db: DatabaseSync, itemId: string): void {
  db.prepare("DELETE FROM item_entities WHERE item_id = ?").run(itemId);
}
