import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem, insertItem } from "@/db/queries";
import { deriveProposal, extractClaimed, type ExtractDb } from "@/extract/extract-item";
import { FixtureExtractor } from "@/extract/fixture";
import type { ExtractInput, ExtractionResult, Extractor } from "@/extract/provider";
import { claim } from "@/jobs/extract";

const NOW = new Date("2026-11-18T12:00:00.000Z");
const clock = () => NOW;

/** A file-backed database, so a second connection can open the same file. */
function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "revenant-extract-"));
  mkdirSync(join(dataDir, "uploads"));
  const dbPath = join(dataDir, "revenant.db");
  const db = openDb(dbPath);
  migrate(db);
  return { dataDir, dbPath, db };
}

function addItem(db: ExtractDb, dataDir: string, id: string, createdAt = NOW.toISOString()) {
  const sha256 = id.padEnd(64, "0");
  const storedPath = `uploads/${sha256}.jpg`;
  writeFileSync(join(dataDir, storedPath), Buffer.from(`image bytes for ${id}`));
  insertItem(db, { id, sha256, fileName: `${id}.jpg`, storedPath, now: createdAt });
  return { id, storedPath };
}

function auditRows(db: ExtractDb, itemId: string) {
  return db
    .prepare("SELECT action, actor, before_json, after_json FROM audit_events WHERE item_id = ? ORDER BY rowid")
    .all(itemId) as Array<{ action: string; actor: string; before_json: string | null; after_json: string | null }>;
}

/** Counts calls and otherwise behaves as the fixture. */
class CountingExtractor implements Extractor {
  readonly model = "fixture";
  readonly promptVersion = "fixture";
  calls = 0;
  private readonly inner: Extractor = new FixtureExtractor();
  async extract(input: ExtractInput): Promise<ExtractionResult> {
    this.calls += 1;
    return this.inner.extract(input);
  }
}

describe("claim", () => {
  it("moves a queued item to extracting with one extract_started row", () => {
    const { db, dataDir } = setup();
    const item = addItem(db, dataDir, "item-a");
    expect(claim(db, "cli", NOW)).toEqual({ id: item.id, storedPath: item.storedPath });
    expect(getItem(db, item.id)?.status).toBe("extracting");
    expect(getItem(db, item.id)?.updated_at).toBe(NOW.toISOString());
    const rows = auditRows(db, item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      action: "extract_started",
      actor: "cli",
      before_json: JSON.stringify({ status: "queued" }),
      after_json: JSON.stringify({ status: "extracting" }),
    });
  });

  it("returns null and changes nothing when the item is already claimed", () => {
    const { db, dataDir } = setup();
    const item = addItem(db, dataDir, "item-a");
    claim(db, "cli", NOW);
    const later = new Date(NOW.getTime() + 60_000);
    expect(claim(db, "cli", later)).toBeNull();
    expect(claim(db, "cli", later, item.id)).toBeNull();
    expect(getItem(db, item.id)?.updated_at).toBe(NOW.toISOString());
    expect(auditRows(db, item.id)).toHaveLength(1);
  });

  it("lets only one of two connections claim the same queued item", async () => {
    const { db, dataDir, dbPath } = setup();
    const item = addItem(db, dataDir, "item-a");
    const other = openDb(dbPath);
    const extractor = new CountingExtractor();
    // node:sqlite is synchronous, so the two claims serialise in this process; the second
    // connection must see the first one's committed claim.
    const outcomes = await Promise.all(
      [db, other].map(async (connection) => {
        const claimed = claim(connection, "cli", NOW);
        return claimed ? extractClaimed(claimed, { db: connection, dataDir, extractor, actor: "cli", now: clock }) : null;
      }),
    );
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
    expect(extractor.calls).toBe(1);
    expect(auditRows(db, item.id).filter((row) => row.action === "extract_started")).toHaveLength(1);
    other.close();
  });

  it("does not claim a named item that is not queued", () => {
    const { db, dataDir } = setup();
    const item = addItem(db, dataDir, "item-a");
    db.prepare("UPDATE items SET status = 'needs_review' WHERE id = ?").run(item.id);
    expect(claim(db, "cli", NOW, item.id)).toBeNull();
    expect(getItem(db, item.id)?.status).toBe("needs_review");
    expect(auditRows(db, item.id)).toHaveLength(0);
  });

  it("claims the oldest queued item first", () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "item-new", "2026-11-18T11:00:00.000Z");
    addItem(db, dataDir, "item-old", "2026-11-18T10:00:00.000Z");
    expect(claim(db, "cli", NOW)?.id).toBe("item-old");
  });
});

describe("extractClaimed", () => {
  it("stores one extraction with provenance and touches nothing review owns", async () => {
    const { db, dataDir } = setup();
    const item = addItem(db, dataDir, "item-a");
    const claimed = claim(db, "cli", NOW);
    expect(claimed).not.toBeNull();
    if (!claimed) return;
    const extractor: Extractor = new FixtureExtractor();
    const fixture = await extractor.extract({ image: Buffer.alloc(0), mimeType: "image/jpeg" });

    const outcome = await extractClaimed(claimed, { db, dataDir, extractor, actor: "cli", now: clock });

    const rows = db.prepare("SELECT * FROM extractions").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      item_id: item.id,
      model: "fixture",
      prompt_version: "fixture",
      raw_json: fixture.raw,
      latency_ms: 0,
    });
    expect(outcome).toEqual({
      itemId: item.id,
      status: "extracted",
      extractionId: rows[0]?.id,
      model: "fixture",
      promptVersion: "fixture",
      latencyMs: 0,
    });
    expect(getItem(db, item.id)).toMatchObject({ status: "needs_review", error: null });

    const audit = auditRows(db, item.id);
    expect(audit.map((row) => row.action)).toEqual(["extract_started", "extract"]);
    expect(JSON.parse(audit[1]?.before_json ?? "null")).toEqual({ status: "extracting" });
    expect(JSON.parse(audit[1]?.after_json ?? "null")).toEqual({
      status: "needs_review",
      extractionId: rows[0]?.id,
      model: "fixture",
      promptVersion: "fixture",
      latencyMs: 0,
      repaired: false,
      coerced: false,
    });

    // Requirement 2's write-surface boundary: extraction proposes, it never writes a record.
    expect(countRows(db, "records")).toBe(0);
    expect(countRows(db, "entities")).toBe(0);
    expect(countRows(db, "item_entities")).toBe(0);
    expect(countRows(db, "places")).toBe(0);
  });

  it("stores raw text that derives the same proposal as the fixture's raw", async () => {
    const { db, dataDir } = setup();
    addItem(db, dataDir, "item-a");
    const claimed = claim(db, "cli", NOW);
    if (!claimed) throw new Error("expected a claim");
    const extractor: Extractor = new FixtureExtractor();
    const fixture = await extractor.extract({ image: Buffer.alloc(0), mimeType: "image/jpeg" });
    await extractClaimed(claimed, { db, dataDir, extractor, actor: "cli", now: clock });

    const stored = db.prepare("SELECT raw_json FROM extractions").get() as { raw_json: string };
    expect(deriveProposal(stored.raw_json, NOW)).toEqual(deriveProposal(fixture.raw, NOW));
  });

  it("writes nothing when the item is no longer extracting at the finish", async () => {
    const { db, dataDir } = setup();
    const item = addItem(db, dataDir, "item-a");
    const claimed = claim(db, "cli", NOW);
    if (!claimed) throw new Error("expected a claim");
    db.prepare("UPDATE items SET status = 'queued' WHERE id = ?").run(item.id);

    const outcome = await extractClaimed(claimed, {
      db,
      dataDir,
      extractor: new FixtureExtractor(),
      actor: "cli",
      now: clock,
    });

    expect(outcome).toEqual({ itemId: item.id, status: "not_claimed", current: "queued" });
    expect(countRows(db, "extractions")).toBe(0);
    expect(auditRows(db, item.id).map((row) => row.action)).toEqual(["extract_started"]);
    expect(db.isTransaction).toBe(false);
  });
});
