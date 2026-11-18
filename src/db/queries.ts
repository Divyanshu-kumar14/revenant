import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ItemRow, ItemStatus } from "./types";

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
