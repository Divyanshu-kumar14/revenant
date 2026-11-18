import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, findItemBySha, getItem, insertItem, writeAudit } from "@/db/queries";

const INSERT_ITEM =
  "INSERT INTO items (id,sha256,file_name,stored_path,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)";

describe("sqlite client and schema", () => {
  it("migrates twice and enforces unique sha256", () => {
    const db = openDb(":memory:");
    migrate(db);
    migrate(db);
    const now = "2026-11-18T00:00:00Z";
    db.prepare(INSERT_ITEM).run("i1", "abc", "a.jpg", "/tmp/a.jpg", "queued", now, now);
    expect(() =>
      db.prepare(INSERT_ITEM).run("i2", "abc", "b.jpg", "/tmp/b.jpg", "queued", now, now),
    ).toThrow(/UNIQUE/);
  });
});

describe("extractions.prompt_version migration", () => {
  // The extractions definition before the prompt_version column existed.
  const OLD_SCHEMA = `
    CREATE TABLE items (
      id TEXT PRIMARY KEY, sha256 TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
      stored_path TEXT NOT NULL, caption TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued','extracting','needs_review','published','rejected')),
      error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE extractions (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES items(id), model TEXT NOT NULL,
      raw_json TEXT NOT NULL, latency_ms INTEGER, created_at TEXT NOT NULL
    );`;
  const at = "2026-11-18T00:00:00Z";
  const columns = (db: ReturnType<typeof openDb>) =>
    (db.prepare("PRAGMA table_info(extractions)").all() as Array<{ name: string }>).map((c) => c.name);

  it("a fresh database has prompt_version after one migrate()", () => {
    const db = openDb(":memory:");
    migrate(db);
    expect(columns(db)).toContain("prompt_version");
  });

  it("an existing database with the old definition gains the column and keeps its rows", () => {
    const db = openDb(":memory:");
    db.exec(OLD_SCHEMA);
    db.prepare(INSERT_ITEM).run("i1", "abc", "a.jpg", "uploads/abc.jpg", "needs_review", at, at);
    db.prepare("INSERT INTO extractions (id,item_id,model,raw_json,latency_ms,created_at) VALUES (?,?,?,?,?,?)").run(
      "e1", "i1", "m", "{}", 10, at,
    );
    expect(columns(db)).not.toContain("prompt_version");

    migrate(db);

    expect(columns(db)).toContain("prompt_version");
    expect(db.prepare("SELECT id, item_id, model, raw_json, latency_ms, prompt_version FROM extractions").all()).toEqual([
      { id: "e1", item_id: "i1", model: "m", raw_json: "{}", latency_ms: 10, prompt_version: "v1" },
    ]);
  });

  it("migrate() twice leaves exactly one prompt_version column", () => {
    const db = openDb(":memory:");
    db.exec(OLD_SCHEMA);
    migrate(db);
    migrate(db);
    expect(columns(db).filter((name) => name === "prompt_version")).toHaveLength(1);
  });

  it("defaults prompt_version to 'v1' on an insert that omits it", () => {
    const db = openDb(":memory:");
    migrate(db);
    db.prepare(INSERT_ITEM).run("i1", "abc", "a.jpg", "uploads/abc.jpg", "needs_review", at, at);
    db.prepare("INSERT INTO extractions (id,item_id,model,raw_json,created_at) VALUES (?,?,?,?,?)").run(
      "e1", "i1", "m", "{}", at,
    );
    expect(db.prepare("SELECT prompt_version FROM extractions WHERE id = ?").get("e1")).toEqual({ prompt_version: "v1" });
  });
});

const NOW = "2026-11-18T00:00:00Z";
function freshDb() {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}
const newItem = (id: string, sha256: string) => ({
  id,
  sha256,
  fileName: `${id}.jpg`,
  storedPath: `/tmp/${sha256}.jpg`,
  caption: null,
  now: NOW,
});

describe("query helpers", () => {
  it("insertItem stores a queued item and returns it; duplicate sha256 throws", () => {
    const db = freshDb();
    const row = insertItem(db, newItem("i1", "abc"));
    expect(row).toMatchObject({
      id: "i1",
      sha256: "abc",
      file_name: "i1.jpg",
      stored_path: "/tmp/abc.jpg",
      caption: null,
      status: "queued",
      error: null,
      created_at: NOW,
      updated_at: NOW,
    });
    expect(() => insertItem(db, newItem("i2", "abc"))).toThrow(/UNIQUE/);
  });

  it("findItemBySha returns the matching item or null", () => {
    const db = freshDb();
    insertItem(db, newItem("i1", "abc"));
    expect(findItemBySha(db, "abc")?.id).toBe("i1");
    expect(findItemBySha(db, "zzz")).toBeNull();
  });

  it("getItem returns the item by id or null", () => {
    const db = freshDb();
    insertItem(db, newItem("i1", "abc"));
    expect(getItem(db, "i1")?.sha256).toBe("abc");
    expect(getItem(db, "nope")).toBeNull();
  });

  it("countRows counts known tables and rejects unknown names", () => {
    const db = freshDb();
    expect(countRows(db, "items")).toBe(0);
    insertItem(db, newItem("i1", "abc"));
    expect(countRows(db, "items")).toBe(1);
    expect(() => countRows(db, "items; DROP TABLE items")).toThrow(/unknown table/i);
    expect(() => countRows(db, "sqlite_master")).toThrow(/unknown table/i);
  });

  it("writeAudit appends rows and round-trips before/after JSON", () => {
    const db = freshDb();
    insertItem(db, newItem("i1", "abc"));
    const before = { status: "queued" };
    const after = { status: "extracting", n: [1, 2] };
    writeAudit(db, { itemId: "i1", actor: "volunteer", action: "status_change", before, after, at: NOW });
    writeAudit(db, { itemId: "i1", actor: "volunteer", action: "duplicate_ingest", before: null, after: null });
    const rows = db
      .prepare("SELECT * FROM audit_events WHERE item_id = ? ORDER BY rowid")
      .all("i1") as Array<Record<string, string | null>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actor: "volunteer", action: "status_change", created_at: NOW });
    expect(JSON.parse(rows[0].before_json ?? "null")).toEqual(before);
    expect(JSON.parse(rows[0].after_json ?? "null")).toEqual(after);
    expect(rows[1].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});
