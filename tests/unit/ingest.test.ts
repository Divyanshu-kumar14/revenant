import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem } from "@/db/queries";
import { contentHash } from "@/ingest/hash";
import { ingestFile, type IngestDb } from "@/ingest/ingest";
import { normalizeImage } from "@/ingest/image";
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
  it("never deletes an earlier upload's file when the write fails with EEXIST", async () => {
    const deps = setup();
    const bytes = await smallSquare();
    const first = await ingestFile({ fileName: "front.jpg", bytes }, deps);
    const stored = join(deps.dataDir, "uploads", `${first.sha256}.jpg`);
    const before = readFileSync(stored);
    // An orphaned file: the row is gone but the bytes on disk are from a successful upload.
    deps.db.prepare("DELETE FROM audit_events WHERE item_id = ?").run(first.itemId);
    deps.db.prepare("DELETE FROM items WHERE id = ?").run(first.itemId);

    const err = await ingestFile({ fileName: "again.jpg", bytes }, deps).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "IngestError", code: "STORE_FAILED" });
    expect(readFileSync(stored).equals(before)).toBe(true);
    expect(countRows(deps.db, "items")).toBe(0);
  });

  it("throws STORE_FAILED and leaves no partial file when the target path is a directory", async () => {
    const deps = setup();
    const bytes = await smallSquare();
    const sha256 = contentHash((await normalizeImage(bytes)).bytes);
    const target = join(deps.dataDir, "uploads", `${sha256}.jpg`);
    mkdirSync(target);

    const err = await ingestFile({ fileName: "front.jpg", bytes }, deps).catch((e: unknown) => e);

    expect(err).toMatchObject({ name: "IngestError", code: "STORE_FAILED" });
    expect(lstatSync(target).isDirectory()).toBe(true);
    expect(readdirSync(target)).toEqual([]);
    expect(uploads(deps)).toEqual([`${sha256}.jpg`]);
    expect(countRows(deps.db, "items")).toBe(0);
  });

  it("surfaces the original error and still removes the file when ROLLBACK itself throws", async () => {
    const deps = setup();
    const real = deps.db;
    // Wrap the real connection: COMMIT fails after the file is written, then ROLLBACK fails too.
    const db = new Proxy(real, {
      get(target, prop) {
        if (prop === "exec") {
          return (sql: string) => {
            if (sql === "COMMIT") throw new Error("commit failed");
            if (sql === "ROLLBACK") throw new Error("rollback failed");
            return target.exec(sql);
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as IngestDb;

    const err = await ingestFile({ fileName: "front.jpg", bytes: await smallSquare() }, { ...deps, db }).catch(
      (e: unknown) => e,
    );
    real.exec("ROLLBACK");

    expect(err).toMatchObject({ message: "commit failed" });
    expect(uploads(deps)).toEqual([]);
    expect(countRows(real, "items")).toBe(0);
  });
});
