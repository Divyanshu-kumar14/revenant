import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_BATCH, POST } from "@/app/api/admin/extract/route";
import { SESSION_COOKIE, createSession } from "@/auth/session";
import { migrate, openDb } from "@/db/client";
import { countRows, getItem, insertItem } from "@/db/queries";

const SECRET = "route-test-secret-padded-to-32-chars";
const URL_ = "http://localhost/api/admin/extract";

const originalSecret = process.env.SESSION_SECRET;
const originalDataDir = process.env.REVENANT_DATA_DIR;
const originalExtractor = process.env.EXTRACTOR;

let dataDir = "";

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  process.env.EXTRACTOR = "fixture";
  dataDir = mkdtempSync(join(tmpdir(), "revenant-extract-route-"));
  process.env.REVENANT_DATA_DIR = dataDir;
  mkdirSync(join(dataDir, "uploads"), { recursive: true });
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  if (originalDataDir === undefined) delete process.env.REVENANT_DATA_DIR;
  else process.env.REVENANT_DATA_DIR = originalDataDir;
  if (originalExtractor === undefined) delete process.env.EXTRACTOR;
  else process.env.EXTRACTOR = originalExtractor;
  rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

const validCookie = () => `${SESSION_COOKIE}=${createSession("volunteer", SECRET)}`;

/** Seed one queued item in the directory the route will open, upload file included. */
function addItem(id: string): void {
  const db = openDb(join(dataDir, "revenant.db"));
  migrate(db);
  const sha256 = id.padEnd(64, "0");
  const storedPath = `uploads/${sha256}.jpg`;
  writeFileSync(join(dataDir, storedPath), Buffer.from(`image bytes for ${id}`));
  insertItem(db, { id, sha256, fileName: `${id}.jpg`, storedPath });
  db.close();
}

function request(options: { cookie?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.cookie) headers.cookie = options.cookie;
  return new Request(URL_, {
    method: "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function countAudit(): number {
  const db = openDb(join(dataDir, "revenant.db"));
  const count = countRows(db, "audit_events");
  db.close();
  return count;
}

describe("POST /api/admin/extract", () => {
  it("answers 401 without a session and claims nothing", async () => {
    addItem("a");

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ status: "error", error: { code: "UNAUTHORIZED" } });
    expect(countAudit()).toBe(0);
  });

  it("answers 400 for a limit below 1, above MAX_BATCH or fractional", async () => {
    addItem("a");
    for (const limit of [0, MAX_BATCH + 1, 1.5]) {
      const response = await POST(request({ cookie: validCookie(), body: { limit } }));
      expect(response.status, `limit ${limit}`).toBe(400);
    }
    expect(countAudit()).toBe(0);
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await POST(
      new Request(URL_, { method: "POST", headers: { cookie: validCookie() }, body: "{not json" }),
    );
    expect(response.status).toBe(400);
  });

  it("extracts a bounded batch and returns counts only", async () => {
    addItem("a");
    addItem("b");
    addItem("c");

    const response = await POST(request({ cookie: validCookie(), body: { limit: 2 } }));

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ requeued: 0, claimed: 2, extracted: 2, failed: 0, queued: 1 });

    // No provider text, raw output or path may appear in the response.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("Fixture: mill pond");
    expect(serialised).not.toContain(dataDir);
    expect(serialised).not.toContain("Ada Fixture");

    const db = openDb(join(dataDir, "revenant.db"));
    expect(getItem(db, "a")).toMatchObject({ status: "needs_review" });
    expect(getItem(db, "c")).toMatchObject({ status: "queued" });
    expect(countRows(db, "extractions")).toBe(2);
    db.close();
  });

  it("uses MAX_BATCH when the body is empty", async () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) addItem(id);

    const response = await POST(request({ cookie: validCookie() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claimed: MAX_BATCH, extracted: MAX_BATCH, queued: 1 });
  });

  it("answers 500 CONFIG and leaves every item queued when the extractor cannot be built", async () => {
    process.env.EXTRACTOR = "bogus";
    addItem("a");
    addItem("b");

    const response = await POST(request({ cookie: validCookie() }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: "error", error: { code: "CONFIG" } });

    const db = openDb(join(dataDir, "revenant.db"));
    expect(getItem(db, "a")).toMatchObject({ status: "queued" });
    expect(getItem(db, "b")).toMatchObject({ status: "queued" });
    expect(countRows(db, "audit_events")).toBe(0);
    db.close();
  });

  it("answers 500 CONFIG when SESSION_SECRET is missing", async () => {
    delete process.env.SESSION_SECRET;

    const response = await POST(request({ cookie: validCookie() }));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: "error", error: { code: "CONFIG" } });
  });
});
