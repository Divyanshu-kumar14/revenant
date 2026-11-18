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

/** Apply schema.sql. Safe to run any number of times. */
export function migrate(db: DatabaseSync): void {
  db.exec(readFileSync(SCHEMA_URL, "utf8"));
}
