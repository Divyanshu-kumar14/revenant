import { mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** The one definition of the default data directory for the whole app. */
const DEFAULT_DATA_DIR = "./data";

/** Where the database and uploads live: $REVENANT_DATA_DIR, or ./data. */
export function resolveDataDir(): string {
  return process.env.REVENANT_DATA_DIR ?? DEFAULT_DATA_DIR;
}

/** A data directory that cannot be created or written. `code` is the underlying errno code. */
export class DataDirError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(path: string, code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DataDirError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Create `dir` and `dir/uploads` if absent and prove both are writable.
 * Throws DataDirError naming the absolute path and the errno code. Safe to call repeatedly.
 */
export function ensureDataDir(dir: string): { dataDir: string; uploadsDir: string } {
  const dataDir = resolve(dir);
  const uploadsDir = join(dataDir, "uploads");
  for (const path of [dataDir, uploadsDir]) {
    rejectRegularFile(path);
    attempt(path, "create", () => mkdirSync(path, { recursive: true }));
    // The database writes its WAL files beside it; uploads are written with `wx`.
    const probe = join(path, `.write-probe-${process.pid}`);
    attempt(path, "write to", () => {
      writeFileSync(probe, "");
      unlinkSync(probe);
    });
  }
  return { dataDir, uploadsDir };
}

function rejectRegularFile(path: string): void {
  const stats = attempt(path, "inspect", () => statSync(path, { throwIfNoEntry: false }));
  if (stats && !stats.isDirectory()) {
    throw new DataDirError(path, "ENOTDIR", `Data directory check failed: ${path} exists but is not a directory.`);
  }
}

function attempt<T>(path: string, action: string, step: () => T): T {
  try {
    return step();
  } catch (error) {
    const code = errnoCode(error);
    throw new DataDirError(path, code, `Data directory check failed: could not ${action} ${path} (${code}).`, {
      cause: error,
    });
  }
}

function errnoCode(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return "UNKNOWN";
}
