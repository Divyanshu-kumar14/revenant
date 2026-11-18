import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem, insertItem } from "@/db/queries";
import type { ExtractDb } from "@/extract/extract-item";
import { FixtureExtractor } from "@/extract/fixture";
import { createExtractor } from "@/extract/extract-item";
import { STALE_CLAIM_MS, requeueStale, runBatch } from "@/jobs/extract";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const clock = () => NOW;

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "revenant-batch-"));
  mkdirSync(join(dataDir, "uploads"));
  const db = openDb(join(dataDir, "revenant.db"));
  migrate(db);
  return { dataDir, db };
}

function addItem(db: ExtractDb, dataDir: string, id: string, createdAt: string) {
  const sha256 = id.padEnd(64, "0");
  const storedPath = `uploads/${sha256}.jpg`;
  writeFileSync(join(dataDir, storedPath), Buffer.from(`image bytes for ${id}`));
  insertItem(db, { id, sha256, fileName: `${id}.jpg`, storedPath, now: createdAt });
  return { id, storedPath };
}

function deps(db: ExtractDb, dataDir: string) {
  return { db, dataDir, extractor: new FixtureExtractor(), actor: "cli", now: clock };
}

function auditActions(db: ExtractDb, itemId: string): string[] {
  return (
    db
      .prepare("SELECT action FROM audit_events WHERE item_id = ? ORDER BY rowid")
      .all(itemId) as Array<{ action: string }>
  ).map((row) => row.action);
}

/** A child environment without this shell's provider settings. */
function childEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NVIDIA_API_KEY;
  delete env.NVAPI_API_KEY;
  delete env.EXTRACTOR;
  delete env.VISION_PROVIDER;
  delete env.VISION_BASE_URL;
  return { ...env, ...overrides };
}

function runCli(args: string[], env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/extract.ts", ...args], {
    cwd: process.cwd(),
    env: childEnv(env),
    encoding: "utf8",
  });
}

describe("runBatch", () => {
  it("extracts oldest first, stops at the limit and reports the counts", async () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "a", "2026-11-18T11:57:00.000Z");
    addItem(db, dataDir, "b", "2026-11-18T11:58:00.000Z");
    addItem(db, dataDir, "c", "2026-11-18T11:59:00.000Z");

    const summary = await runBatch(deps(db, dataDir), { limit: 2 });

    expect(summary.outcomes.map((outcome) => outcome.itemId)).toEqual(["a", "b"]);
    expect(summary).toMatchObject({ requeued: 0, claimed: 2, extracted: 2, failed: 0, queued: 1 });
    expect(countRows(db, "extractions")).toBe(2);
    expect(getItem(db, "c")).toMatchObject({ status: "queued" });
  });

  it("claims nothing when --item names an item that is not queued", async () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "done", "2026-11-18T11:57:00.000Z");
    db.prepare("UPDATE items SET status = 'published' WHERE id = ?").run("done");

    const summary = await runBatch(deps(db, dataDir), { limit: 5, itemId: "done" });

    expect(summary).toMatchObject({ claimed: 0, extracted: 0, failed: 0, queued: 0 });
    expect(summary.outcomes).toEqual([]);
    expect(getItem(db, "done")).toMatchObject({ status: "published" });
    expect(auditActions(db, "done")).toEqual([]);
  });

  it("extracts only the named item and leaves the rest of the queue alone", async () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "a", "2026-11-18T11:57:00.000Z");
    addItem(db, dataDir, "b", "2026-11-18T11:58:00.000Z");

    const summary = await runBatch(deps(db, dataDir), { limit: 5, itemId: "b" });

    expect(summary.outcomes.map((outcome) => outcome.itemId)).toEqual(["b"]);
    expect(getItem(db, "a")).toMatchObject({ status: "queued" });
    expect(getItem(db, "b")).toMatchObject({ status: "needs_review" });
  });

  it("recovers a stale claim and extracts it in the same run", async () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "stale", "2026-11-18T11:40:00.000Z");
    db.prepare("UPDATE items SET status = 'extracting', updated_at = ? WHERE id = ?").run(
      new Date(NOW.getTime() - 16 * 60 * 1000).toISOString(),
      "stale",
    );

    const summary = await runBatch(deps(db, dataDir), { limit: 5 });

    expect(summary).toMatchObject({ requeued: 1, claimed: 1, extracted: 1, queued: 0 });
    expect(auditActions(db, "stale")).toEqual(["extract_interrupted", "extract_started", "extract"]);
  });
});

describe("requeueStale", () => {
  it("returns a sixteen-minute-old claim to queued with one extract_interrupted row", () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "stale", "2026-11-18T11:40:00.000Z");
    const since = new Date(NOW.getTime() - 16 * 60 * 1000).toISOString();
    db.prepare("UPDATE items SET status = 'extracting', updated_at = ? WHERE id = ?").run(since, "stale");

    expect(requeueStale(db, "cli", NOW)).toEqual(["stale"]);

    expect(getItem(db, "stale")).toMatchObject({ status: "queued" });
    const row = db
      .prepare("SELECT before_json, after_json FROM audit_events WHERE item_id = ?")
      .get("stale") as { before_json: string; after_json: string };
    expect(JSON.parse(row.before_json)).toEqual({ status: "extracting", since });
    expect(JSON.parse(row.after_json)).toEqual({ status: "queued" });
    expect(db.isTransaction).toBe(false);
  });

  it("leaves a fourteen-minute-old claim alone", () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "busy", "2026-11-18T11:40:00.000Z");
    db.prepare("UPDATE items SET status = 'extracting', updated_at = ? WHERE id = ?").run(
      new Date(NOW.getTime() - 14 * 60 * 1000).toISOString(),
      "busy",
    );

    expect(requeueStale(db, "cli", NOW)).toEqual([]);

    expect(getItem(db, "busy")).toMatchObject({ status: "extracting" });
    expect(auditActions(db, "busy")).toEqual([]);
  });

  it("uses a fifteen-minute threshold", () => {
    expect(STALE_CLAIM_MS).toBe(15 * 60 * 1000);
  });
});

describe("pnpm extract", () => {
  it("prints the summary and exits 0 on an empty queue, with no provider", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "revenant-cli-"));

    const result = runCli(["--limit=0"], { REVENANT_DATA_DIR: dataDir, EXTRACTOR: "fixture" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("requeued 0, claimed 0, extracted 0, failed 0, queued 0");
  });

  it("exits non-zero on NO_KEY before claiming anything, leaving every item queued", () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "a", "2026-11-18T11:57:00.000Z");
    db.close();

    const result = runCli(["--limit=5"], { REVENANT_DATA_DIR: dataDir, EXTRACTOR: "provider" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("extract: NO_KEY");

    const reopened = openDb(join(dataDir, "revenant.db"));
    expect(getItem(reopened, "a")).toMatchObject({ status: "queued" });
    expect(countRows(reopened, "audit_events")).toBe(0);
    expect(countRows(reopened, "extractions")).toBe(0);
    reopened.close();
  });

  it("rejects a malformed limit without touching the queue", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "revenant-cli-"));

    const result = runCli(["--limit=lots"], { REVENANT_DATA_DIR: dataDir, EXTRACTOR: "fixture" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--limit must be a non-negative integer");
  });
});

describe("createExtractor ordering", () => {
  it("raises before a batch can claim, which is why the CLI builds it first", () => {
    expect(() => createExtractor({ NODE_ENV: "test" })).toThrowError(/NO_KEY|not set/);
  });
});
