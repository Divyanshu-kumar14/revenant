import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ensureDataDir } from "@/data-dir";
import { migrate, openDb } from "@/db/client";

const BUSY_RETRY_MS = 50;
const SQLITE_BUSY = 5;

const connections = new Map<string, DatabaseSync>();

/**
 * One migrated connection per data directory, opened on first use after the directory check.
 * Creates the data directory and uploads/ on a fresh container; throws DataDirError if either
 * cannot be written, and closes the connection if migration fails.
 */
export function serverDb(dataDir: string): DatabaseSync {
  const path = join(dataDir, "revenant.db");
  const existing = connections.get(path);
  if (existing) return existing;
  ensureDataDir(dataDir);
  const db = openDb(path);
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  connections.set(path, db);
  return db;
}

/** Run `attempt`; on SQLITE_BUSY wait 50 ms and run it exactly once more. */
export async function withBusyRetry<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isBusy(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
    return attempt();
  }
}

export function isBusy(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errcode = (error as Error & { errcode?: unknown }).errcode;
  // Extended result codes (e.g. SQLITE_BUSY_SNAPSHOT) carry the primary code in the low byte.
  return typeof errcode === "number" && (errcode & 0xff) === SQLITE_BUSY;
}
