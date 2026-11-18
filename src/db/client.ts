import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveDataDir } from "@/data-dir";

const SCHEMA_URL = new URL("./schema.sql", import.meta.url);

/** Open a database with WAL and foreign keys on. Defaults to $REVENANT_DATA_DIR/revenant.db. */
export function openDb(path?: string): DatabaseSync {
  const target = path ?? join(resolveDataDir(), "revenant.db");
  const db = new DatabaseSync(target);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  return db;
}

/**
 * Apply schema.sql, then add columns that `CREATE TABLE IF NOT EXISTS` cannot add to an
 * existing table. Each ALTER is guarded by PRAGMA table_info, so this is safe to run any number of times.
 */
export function migrate(db: DatabaseSync): void {
  db.exec(readFileSync(SCHEMA_URL, "utf8"));
  const extractionColumns = db.prepare("PRAGMA table_info(extractions)").all() as Array<{ name: unknown }>;
  if (!extractionColumns.some((column) => column.name === "prompt_version")) {
    // SQLite allows ADD COLUMN ... NOT NULL only with a non-null default.
    db.exec("ALTER TABLE extractions ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1'");
  }
}

/**
 * Roll back if a transaction is still open. A failing ROLLBACK is ignored so the caller's
 * original error is the one that propagates, never the rollback's.
 */
export function rollbackQuietly(db: DatabaseSync): void {
  try {
    if (db.isTransaction) db.exec("ROLLBACK");
  } catch {
    // Ignored on purpose: the original error is more useful than the rollback's.
  }
}
