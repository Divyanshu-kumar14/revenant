import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import {
  getLatestExtraction,
  insertExtraction,
  insertItem,
  linkItemEntity,
  listItemEntities,
  listNeedsReviewIds,
  transitionItem,
  upsertEntity,
} from "@/db/queries";

type Db = ReturnType<typeof openDb>;

function freshDb(): Db {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

function seed(db: Db, id: string, createdAt: string, status: "queued" | "needs_review" = "needs_review") {
  insertItem(db, { id, sha256: `sha-${id}`, fileName: `${id}.jpg`, storedPath: `uploads/${id}.jpg`, now: createdAt });
  if (status !== "queued") transitionItem(db, { id, from: "queued", to: status, error: null, at: createdAt });
}

function extraction(itemId: string, id: string, rawJson: string, createdAt: string) {
  return { id, itemId, model: "m", promptVersion: "p", rawJson, latencyMs: 1, createdAt };
}

describe("getLatestExtraction", () => {
  it("returns null for an item with no extraction", () => {
    const db = freshDb();
    seed(db, "i1", "2026-01-01T00:00:00Z");
    expect(getLatestExtraction(db, "i1")).toBeNull();
  });

  it("returns the newest by created_at", () => {
    const db = freshDb();
    seed(db, "i1", "2026-01-01T00:00:00Z");
    insertExtraction(db, extraction("i1", "e2", "{\"n\":2}", "2026-01-03T00:00:00Z"));
    insertExtraction(db, extraction("i1", "e1", "{\"n\":1}", "2026-01-02T00:00:00Z"));
    expect(getLatestExtraction(db, "i1")).toEqual({
      rawJson: "{\"n\":2}",
      model: "m",
      promptVersion: "p",
      createdAt: "2026-01-03T00:00:00Z",
    });
  });

  it("breaks a created_at tie by insertion order", () => {
    const db = freshDb();
    seed(db, "i1", "2026-01-01T00:00:00Z");
    insertExtraction(db, extraction("i1", "a", "first", "2026-01-02T00:00:00Z"));
    insertExtraction(db, extraction("i1", "b", "second", "2026-01-02T00:00:00Z"));
    expect(getLatestExtraction(db, "i1")?.rawJson).toBe("second");
  });
});

describe("listItemEntities", () => {
  it("lists links ordered by type then name, for one item only", () => {
    const db = freshDb();
    seed(db, "i1", "2026-01-01T00:00:00Z");
    seed(db, "i2", "2026-01-01T00:00:01Z");
    const link = (itemId: string, type: "person" | "place" | "subject", name: string, confidence: number | null) => {
      const entityId = upsertEntity(db, { type, name, nameKey: name.toLowerCase() });
      linkItemEntity(db, { itemId, entityId, role: "depicted", confidence });
    };
    link("i1", "place", "London", 0.5);
    link("i1", "person", "Zed", 0.9);
    link("i1", "person", "Ada", null);
    link("i2", "subject", "mills", 0.7);

    expect(listItemEntities(db, "i1")).toEqual([
      { type: "person", name: "Ada", confidence: null },
      { type: "person", name: "Zed", confidence: 0.9 },
      { type: "place", name: "London", confidence: 0.5 },
    ]);
    expect(listItemEntities(db, "none")).toEqual([]);
  });
});

describe("listNeedsReviewIds", () => {
  it("returns only needs_review items, oldest first, id as tie-break", () => {
    const db = freshDb();
    seed(db, "c", "2026-01-02T00:00:00Z");
    seed(db, "b", "2026-01-01T00:00:00Z");
    seed(db, "a", "2026-01-01T00:00:00Z");
    seed(db, "q", "2026-01-01T00:00:00Z", "queued");
    expect(listNeedsReviewIds(db)).toEqual(["a", "b", "c"]);
  });
});
