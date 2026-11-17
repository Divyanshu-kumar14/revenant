import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";

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
