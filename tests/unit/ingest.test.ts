import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem } from "@/db/queries";
import { contentHash } from "@/ingest/hash";
import { ingestFile } from "@/ingest/ingest";
import { invalidBytes, smallSquare } from "../helpers/images";

const NOW = "2026-11-18T12:00:00.000Z";
const MiB = 1024 * 1024;

/** A fresh :memory: database and a temp data dir with an uploads/ folder (Task 9 creates it in production). */
function setup(options: { withUploads?: boolean } = {}) {
  const db = openDb(":memory:");
  migrate(db);
  const dataDir = mkdtempSync(join(tmpdir(), "revenant-ingest-"));
  if (options.withUploads ?? true) mkdirSync(join(dataDir, "uploads"));
  return { db, dataDir };
}

type Deps = ReturnType<typeof setup>;

function auditRows(deps: Deps, action?: string) {
  const rows = deps.db
    .prepare("SELECT * FROM audit_events ORDER BY rowid")
    .all() as Array<Record<string, string | null>>;
  return action ? rows.filter((row) => row.action === action) : rows;
}

function uploads(deps: Deps): string[] {
  const dir = join(deps.dataDir, "uploads");
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Minimal ISO-BMFF header with an HEIC major brand. */
function heicHeader(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "ascii");
  box.write("mif1heic", 16, "ascii");
  return box;
}

describe("ingestFile", () => {
  it("queues a fresh upload, stores the normalised file under its hash, and writes one audit row", async () => {
    const deps = setup();
    const result = await ingestFile(
      { fileName: "front.jpg", bytes: await smallSquare(), caption: "Main Street", now: () => NOW },
      deps,
    );

    expect(result.status).toBe("queued");
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = join(deps.dataDir, "uploads", `${result.sha256}.jpg`);
    expect(existsSync(stored)).toBe(true);
    expect(contentHash(readFileSync(stored))).toBe(result.sha256);

    expect(getItem(deps.db, result.itemId)).toMatchObject({
      sha256: result.sha256,
      file_name: "front.jpg",
      caption: "Main Street",
      status: "queued",
      created_at: NOW,
    });
    const audit = auditRows(deps);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ item_id: result.itemId, actor: "volunteer", created_at: NOW });
  });

  it("returns the existing item for identical bytes under a different name, with one row and one duplicate_ingest audit", async () => {
    const deps = setup();
    const bytes = await smallSquare();
    const first = await ingestFile({ fileName: "front.jpg", bytes }, deps);
    const second = await ingestFile({ fileName: "renamed-copy.jpg", bytes, actor: "margaret" }, deps);

    expect(second).toEqual({ itemId: first.itemId, status: "duplicate", sha256: first.sha256 });
    expect(countRows(deps.db, "items")).toBe(1);
    expect(getItem(deps.db, first.itemId)?.file_name).toBe("front.jpg");
    const duplicates = auditRows(deps, "duplicate_ingest");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ item_id: first.itemId, actor: "margaret" });
    expect(uploads(deps)).toEqual([`${first.sha256}.jpg`]);
  });

  it("throws UNDECODABLE for non-image bytes and leaves no row or file", async () => {
    const deps = setup();
    const err = await ingestFile({ fileName: "notes.jpg", bytes: invalidBytes() }, deps).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "IngestError", code: "UNDECODABLE" });
    expect(countRows(deps.db, "items")).toBe(0);
    expect(countRows(deps.db, "audit_events")).toBe(0);
    expect(uploads(deps)).toEqual([]);
  });

  it("throws TOO_LARGE for input over 25 MiB and leaves no row or file", async () => {
    const deps = setup();
    const bytes = Buffer.alloc(25 * MiB + 1);
    const err = await ingestFile({ fileName: "huge.tif", bytes }, deps).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "IngestError", code: "TOO_LARGE" });
    expect(countRows(deps.db, "items")).toBe(0);
    expect(uploads(deps)).toEqual([]);
  });

  it("throws UNSUPPORTED_FORMAT for HEIC bytes before decoding, with no row", async () => {
    const deps = setup();
    const err = await ingestFile({ fileName: "IMG_0001.HEIC", bytes: heicHeader() }, deps).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "IngestError", code: "UNSUPPORTED_FORMAT" });
    expect(countRows(deps.db, "items")).toBe(0);
  });

  it("throws STORE_FAILED when the file cannot be written and rolls the row back", async () => {
    const deps = setup({ withUploads: false });
    const err = await ingestFile({ fileName: "front.jpg", bytes: await smallSquare() }, deps).catch(
      (e: unknown) => e,
    );

    expect(err).toMatchObject({ name: "IngestError", code: "STORE_FAILED" });
    expect(countRows(deps.db, "items")).toBe(0);
    expect(countRows(deps.db, "audit_events")).toBe(0);
    expect(deps.db.isTransaction).toBe(false);
  });
});
