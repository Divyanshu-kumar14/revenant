import { describe, expect, it } from "vitest";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem, insertItem, transitionItem } from "@/db/queries";
import { reviewItem, type ReviewFields } from "@/review/actions";

const NOW = "2026-11-18T12:00:00.000Z";
const clock = () => new Date(NOW);
const SEEDED_AT = "2026-11-17T09:00:00.000Z";

type Db = ReturnType<typeof openDb>;

function freshDb(): Db {
  const db = openDb(":memory:");
  migrate(db);
  return db;
}

/** Insert an item and move it straight to `status`, optionally with an error code. */
function seed(db: Db, id: string, status: "queued" | "needs_review" = "needs_review", error: string | null = null) {
  insertItem(db, { id, sha256: `sha-${id}`, fileName: `${id}.jpg`, storedPath: `uploads/${id}.jpg`, now: SEEDED_AT });
  if (status !== "queued") transitionItem(db, { id, from: "queued", to: status, error, at: SEEDED_AT });
}

function fields(overrides: Partial<ReviewFields> = {}): ReviewFields {
  return {
    title: "Mill pond at first light",
    description: "A pond with a wooden mill behind it.",
    transcription: "Mill pond, 1938",
    dateDisplay: "1938",
    dateStart: "1938-01-01",
    dateEnd: "1938-12-31",
    datePrecision: "year",
    people: [],
    places: [{ name: "London", confidence: 0.9 }],
    subjects: [{ name: "mills", confidence: 0.8 }],
    confidence: { title: 0.9, date: 0.6 },
    ...overrides,
  };
}

function accept(db: Db, itemId: string, overrides: Partial<ReviewFields> = {}, actor = "admin") {
  return reviewItem(db, { itemId, action: "accept", actor, fields: fields(overrides) }, clock);
}

function decide(
  db: Db,
  itemId: string,
  action: "accept" | "edit" | "reject" | "reopen",
  overrides: Partial<ReviewFields> = {},
  actor = "admin",
) {
  const withFields = action === "accept" || action === "edit";
  return reviewItem(db, { itemId, action, actor, ...(withFields ? { fields: fields(overrides) } : {}) }, clock);
}

interface AuditRow {
  action: string;
  actor: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

function auditRows(db: Db, itemId: string): AuditRow[] {
  return db
    .prepare("SELECT action, actor, before_json, after_json, created_at FROM audit_events WHERE item_id = ?")
    .all(itemId) as unknown as AuditRow[];
}

function recordRow(db: Db, itemId: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM records WHERE item_id = ?").get(itemId) as Record<string, unknown> | undefined;
}

function caught(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error("expected a throw");
}

describe("reviewItem accept", () => {
  it("publishes the item, writes the record and one audit row at the clock instant", () => {
    const db = freshDb();
    seed(db, "i1");

    expect(accept(db, "i1")).toEqual({ status: "published" });

    const item = getItem(db, "i1");
    expect(item).toMatchObject({ status: "published", error: null, updated_at: NOW });
    expect(recordRow(db, "i1")).toEqual({
      item_id: "i1",
      title: "Mill pond at first light",
      description: "A pond with a wooden mill behind it.",
      transcription: "Mill pond, 1938",
      date_start: "1938-01-01",
      date_end: "1938-12-31",
      date_display: "1938",
      date_precision: "year",
      confidence_json: JSON.stringify({ title: 0.9, date: 0.6 }),
      reviewed_by: "admin",
      published_at: NOW,
    });

    const audit = auditRows(db, "i1");
    expect(audit).toHaveLength(1);
    const [row] = audit;
    expect(row).toMatchObject({ action: "accept", actor: "admin", created_at: NOW });
    const before = JSON.parse(row?.before_json ?? "null") as { status: string; record: unknown };
    const after = JSON.parse(row?.after_json ?? "null") as { status: string; record: { title: string } };
    expect(before).toEqual({ status: "needs_review", record: null });
    expect(after.status).toBe("published");
    expect(after.record.title).toBe("Mill pond at first light");
  });

  it("dedupes repeated names, reuses entities across items and matches names by key", () => {
    const db = freshDb();
    seed(db, "i1");
    seed(db, "i2");
    seed(db, "i3");

    accept(db, "i1", {
      people: [
        { name: "Ada Lovelace", confidence: 0.9 },
        { name: "Ada Lovelace", confidence: 0.8 },
      ],
      places: [{ name: "London", confidence: 0.9 }],
      subjects: [],
    });
    expect(countRows(db, "entities")).toBe(2);
    expect(countRows(db, "item_entities")).toBe(2);

    accept(db, "i2", { people: [{ name: "Ada Lovelace", confidence: 0.7 }], places: [], subjects: [] });
    const adaIds = db
      .prepare(
        "SELECT DISTINCT ie.entity_id AS id FROM item_entities ie JOIN entities e ON e.id = ie.entity_id WHERE e.name = 'Ada Lovelace'",
      )
      .all() as Array<{ id: string }>;
    expect(adaIds).toHaveLength(1);
    expect(countRows(db, "entities")).toBe(2);

    accept(db, "i3", {
      people: [
        { name: "O’Brien", confidence: 0.9 },
        { name: "O'Brien", confidence: 0.9 },
      ],
      places: [],
      subjects: [],
    });
    const obrien = db.prepare("SELECT name FROM entities WHERE name_key = ?").all("o'brien") as Array<{ name: string }>;
    expect(obrien).toEqual([{ name: "O’Brien" }]);
  });

  it("clears the extraction error of a failed item it accepts", () => {
    const db = freshDb();
    seed(db, "i1", "needs_review", "EXTRACT_FAILED");

    accept(db, "i1");

    expect(getItem(db, "i1")).toMatchObject({ status: "published", error: null });
  });

  it("throws ItemNotFound for an unknown id and writes nothing", () => {
    const db = freshDb();

    const error = caught(() => accept(db, "missing"));

    expect(error).toMatchObject({ status: 404, code: "ITEM_NOT_FOUND", itemId: "missing" });
    expect([countRows(db, "records"), countRows(db, "item_entities"), countRows(db, "audit_events")]).toEqual([
      0, 0, 0,
    ]);
  });

  it("throws InvalidTransition for a queued item and leaves it untouched", () => {
    const db = freshDb();
    seed(db, "i1", "queued");

    const error = caught(() => accept(db, "i1"));

    expect(error).toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
    expect(getItem(db, "i1")?.status).toBe("queued");
    expect([countRows(db, "records"), countRows(db, "audit_events")]).toEqual([0, 0]);
  });

  it("throws ReviewValidationError naming a field of the wrong type", () => {
    const db = freshDb();
    seed(db, "i1");
    const bad = { ...fields(), title: 42 } as unknown as ReviewFields;

    const error = caught(() => reviewItem(db, { itemId: "i1", action: "accept", actor: "admin", fields: bad }, clock));

    expect(error).toMatchObject({ status: 400, code: "INVALID_FIELDS" });
    expect(Object.keys(error.fields as Record<string, string>)).toContain("title");
    expect(getItem(db, "i1")?.status).toBe("needs_review");
  });

  it("refuses a blank actor and publishes nothing", () => {
    const db = freshDb();
    seed(db, "i1");

    const error = caught(() => accept(db, "i1", {}, "   "));

    expect(error).toMatchObject({ status: 400, code: "INVALID_FIELDS" });
    expect(getItem(db, "i1")?.status).toBe("needs_review");
    expect(countRows(db, "records")).toBe(0);
  });

  // The only test that proves the transaction rolls back: the records CHECK fires after the
  // status update has run. Task 6 turns this SQLite error into a field-level message.
  it("rolls back the status update when the records CHECK rejects inverted dates", () => {
    const db = freshDb();
    seed(db, "i1");

    expect(() => accept(db, "i1", { dateStart: "1950-01-01", dateEnd: "1940-01-01" })).toThrow(/CHECK/);

    expect(getItem(db, "i1")?.status).toBe("needs_review");
    expect(countRows(db, "records")).toBe(0);
    expect(auditRows(db, "i1")).toHaveLength(0);
    expect(db.isTransaction).toBe(false);
  });
});

function snapshot(db: Db, itemId: string) {
  return {
    records: countRows(db, "records"),
    links: countRows(db, "item_entities"),
    audit: auditRows(db, itemId).length,
  };
}

function auditJson(db: Db, itemId: string, action: string) {
  const row = auditRows(db, itemId).find((r) => r.action === action);
  return {
    before: JSON.parse(row?.before_json ?? "null") as { status: string; record: Record<string, unknown> | null },
    after: JSON.parse(row?.after_json ?? "null") as { status: string; record: Record<string, unknown> | null },
  };
}

describe("reviewItem edit", () => {
  it("creates an unpublished record on a never-published item", () => {
    const db = freshDb();
    seed(db, "i1");

    expect(decide(db, "i1", "edit", { title: "Draft title" }, "carol")).toEqual({ status: "needs_review" });

    expect(getItem(db, "i1")?.status).toBe("needs_review");
    expect(recordRow(db, "i1")).toMatchObject({ title: "Draft title", published_at: null, reviewed_by: "carol" });
    const { before, after } = auditJson(db, "i1", "edit");
    expect(before.record).toBeNull();
    expect(after.record?.title).toBe("Draft title");
    expect(db.isTransaction).toBe(false);
  });

  it("replaces entity links on a second edit", () => {
    const db = freshDb();
    seed(db, "i1");

    decide(db, "i1", "edit", { people: [{ name: "Ada Lovelace", confidence: 0.9 }], places: [], subjects: [] });
    decide(db, "i1", "edit", { people: [{ name: "Grace Hopper", confidence: 0.9 }], places: [], subjects: [] });

    const links = db
      .prepare("SELECT e.name FROM item_entities ie JOIN entities e ON e.id = ie.entity_id WHERE ie.item_id = ?")
      .all("i1");
    expect(links).toEqual([{ name: "Grace Hopper" }]);
  });

  it("keeps published_at null when editing after accept, reject and reopen", () => {
    const db = freshDb();
    seed(db, "i1");
    decide(db, "i1", "accept");
    decide(db, "i1", "reject");
    decide(db, "i1", "reopen");

    decide(db, "i1", "edit", { title: "Corrected title" });

    expect(recordRow(db, "i1")).toMatchObject({ title: "Corrected title", published_at: null });
    const { before, after } = auditJson(db, "i1", "edit");
    expect(before.record?.title).toBe("Mill pond at first light");
    expect(after.record?.title).toBe("Corrected title");
  });

  it("throws 409 from published and leaves the stored title alone", () => {
    const db = freshDb();
    seed(db, "i1");
    decide(db, "i1", "accept");

    const error = caught(() => decide(db, "i1", "edit", { title: "Changed" }));

    expect(error).toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
    expect(recordRow(db, "i1")).toMatchObject({ title: "Mill pond at first light" });
  });
});

describe("reviewItem reject", () => {
  it("rejects a needs_review item without creating a record", () => {
    const db = freshDb();
    seed(db, "i1");

    expect(decide(db, "i1", "reject")).toEqual({ status: "rejected" });

    expect(getItem(db, "i1")?.status).toBe("rejected");
    expect(recordRow(db, "i1")).toBeUndefined();
    const { before, after } = auditJson(db, "i1", "reject");
    expect(before).toEqual({ status: "needs_review", record: null });
    expect(after).toEqual({ status: "rejected", record: null });
    expect(db.isTransaction).toBe(false);
  });

  it("clears published_at and keeps the record's content and reviewer", () => {
    const db = freshDb();
    seed(db, "i1");
    decide(db, "i1", "accept", {}, "carol");

    expect(decide(db, "i1", "reject", {}, "dave")).toEqual({ status: "rejected" });

    expect(recordRow(db, "i1")).toMatchObject({
      title: "Mill pond at first light",
      reviewed_by: "carol",
      published_at: null,
    });
    const { before, after } = auditJson(db, "i1", "reject");
    expect(before.record?.published_at).toBe(NOW);
    expect(after.record?.published_at).toBeNull();
    expect(db.isTransaction).toBe(false);
  });
});

describe("reviewItem reopen", () => {
  it("returns a rejected item to needs_review, keeping its error and record", () => {
    const db = freshDb();
    seed(db, "i1", "needs_review", "EXTRACT_FAILED");
    decide(db, "i1", "edit");
    decide(db, "i1", "reject");

    expect(decide(db, "i1", "reopen")).toEqual({ status: "needs_review" });

    expect(getItem(db, "i1")).toMatchObject({ status: "needs_review", error: "EXTRACT_FAILED" });
    expect(recordRow(db, "i1")).toMatchObject({ published_at: null });
    expect(auditJson(db, "i1", "reopen").after.status).toBe("needs_review");
    expect(db.isTransaction).toBe(false);
  });
});

describe("illegal sources for edit, reject and reopen", () => {
  it.each([
    ["edit", "published"],
    ["reject", "queued"],
    ["reopen", "needs_review"],
  ] as const)("%s from %s throws 409 and writes nothing", (action, from) => {
    const db = freshDb();
    seed(db, "i1", from === "queued" ? "queued" : "needs_review");
    if (from === "published") decide(db, "i1", "accept");
    const before = snapshot(db, "i1");

    const error = caught(() => decide(db, "i1", action));

    expect(error).toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
    expect(snapshot(db, "i1")).toEqual(before);
    expect(getItem(db, "i1")?.status).toBe(from);
    expect(db.isTransaction).toBe(false);
  });
});
