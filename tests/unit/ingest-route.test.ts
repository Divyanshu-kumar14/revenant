import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/admin/ingest/route";
import { SESSION_COOKIE, createSession } from "@/auth/session";
import { migrate, openDb } from "@/db/client";
import { countRows } from "@/db/queries";
import { MAX_UPLOAD_BYTES } from "@/ingest/errors";
import { invalidBytes, smallSquare } from "../helpers/images";

const SECRET = "route-test-secret-padded-to-32-chars";
const URL_ = "http://localhost/api/admin/ingest";
const originalSecret = process.env.SESSION_SECRET;
const originalDataDir = process.env.REVENANT_DATA_DIR;

let dataDir = "";

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  // A fresh data dir per test; uploads/ is created here because the startup guard is Task 9.
  dataDir = mkdtempSync(join(tmpdir(), "revenant-route-"));
  mkdirSync(join(dataDir, "uploads"));
  process.env.REVENANT_DATA_DIR = dataDir;
});

afterEach(() => {
  // Assigning undefined to process.env stores the string "undefined", so delete instead.
  if (originalSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSecret;
  if (originalDataDir === undefined) delete process.env.REVENANT_DATA_DIR;
  else process.env.REVENANT_DATA_DIR = originalDataDir;
  rmSync(dataDir, { recursive: true, force: true });
  dataDir = "";
});

const validCookie = () => `${SESSION_COOKIE}=${createSession("volunteer", SECRET)}`;

/** Serialise a multipart body so the request carries a real Content-Length, as a browser sends it. */
async function uploadRequest(
  file: { bytes: Buffer; name: string } | null,
  options: { cookie?: string; caption?: string } = {},
): Promise<Request> {
  const form = new FormData();
  if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: "image/jpeg" }));
  if (options.caption !== undefined) form.set("caption", options.caption);
  const encoded = new Response(form);
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({
    "content-type": encoded.headers.get("content-type") ?? "",
    "content-length": String(body.length),
  });
  if (options.cookie) headers.set("cookie", options.cookie);
  return new Request(URL_, { method: "POST", headers, body });
}

function itemCount(): number {
  const db = openDb(join(dataDir, "revenant.db"));
  migrate(db);
  const n = countRows(db, "items");
  db.close();
  return n;
}

/** Minimal ISO-BMFF header with an HEIC major brand. */
function heicHeader(): Buffer {
  const box = Buffer.alloc(24);
  box.writeUInt32BE(24, 0);
  box.write("ftypheic", 4, "ascii");
  box.write("mif1heic", 16, "ascii");
  return box;
}

describe("POST /api/admin/ingest", () => {
  it("returns 401 without a session and reveals no item fields", async () => {
    const response = await POST(await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ status: "error", error: { code: "UNAUTHORIZED", message: expect.any(String) } });
    expect(itemCount()).toBe(0);
  });

  it("returns 401 for a tampered session cookie", async () => {
    const cookie = validCookie();
    const tampered = cookie.slice(0, -2) + (cookie.endsWith("AA") ? "BB" : "AA");
    const response = await POST(
      await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: tampered }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).not.toHaveProperty("itemId");
    expect(itemCount()).toBe(0);
  });

  it("returns 500 and ingests nothing when SESSION_SECRET is missing", async () => {
    const request = await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: validCookie() });
    delete process.env.SESSION_SECRET;
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("CONFIG");
    expect(itemCount()).toBe(0);
  });

  it("returns 500 CONFIG and ingests nothing when SESSION_SECRET is shorter than 32 characters", async () => {
    const request = await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: validCookie() });
    process.env.SESSION_SECRET = "x".repeat(31);
    const response = await POST(request);

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("CONFIG");
    expect(itemCount()).toBe(0);
  });

  it("returns 413 from the exact file size when the multipart body fits the Content-Length allowance", async () => {
    const request = await uploadRequest(
      { bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1), name: "huge.jpg" },
      { cookie: validCookie() },
    );
    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(413);
    expect(body.error.code).toBe("TOO_LARGE");
    expect(body.error.message).toBe(`The upload is ${MAX_UPLOAD_BYTES + 1} bytes; the limit is ${MAX_UPLOAD_BYTES} bytes.`);
    expect(itemCount()).toBe(0);
  });

  it("returns 413 from Content-Length alone, without reading the body", async () => {
    const request = new Request(URL_, {
      method: "POST",
      headers: {
        cookie: validCookie(),
        "content-type": "multipart/form-data; boundary=x",
        "content-length": String(MAX_UPLOAD_BYTES * 2),
      },
      body: "--x--",
    });
    const response = await POST(request);

    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("TOO_LARGE");
    expect(request.bodyUsed).toBe(false);
  });

  it("returns 411 when Content-Length is absent, without reading the body", async () => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await smallSquare())], "front.jpg"));
    const request = new Request(URL_, { method: "POST", headers: { cookie: validCookie() }, body: form });
    const response = await POST(request);

    expect(response.status).toBe(411);
    expect(request.bodyUsed).toBe(false);
  });

  it("returns 400 when the file field is missing", async () => {
    const response = await POST(await uploadRequest(null, { cookie: validCookie(), caption: "no file" }));

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("returns 422 UNDECODABLE for bytes that are not an image", async () => {
    const response = await POST(
      await uploadRequest({ bytes: invalidBytes(), name: "notes.jpg" }, { cookie: validCookie() }),
    );

    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("UNDECODABLE");
    expect(itemCount()).toBe(0);
  });

  it("returns 422 UNSUPPORTED_FORMAT with an explanation for HEIC bytes", async () => {
    const response = await POST(
      await uploadRequest({ bytes: heicHeader(), name: "IMG_0001.HEIC" }, { cookie: validCookie() }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("UNSUPPORTED_FORMAT");
    expect(body.error.message).toMatch(/JPEG/);
  });

  it("returns 200 queued with the item id and hash for a valid upload", async () => {
    const response = await POST(
      await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: validCookie(), caption: "Main St" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "queued", itemId: expect.any(String), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(itemCount()).toBe(1);
  });

  it("returns 200 duplicate with the existing id when the same bytes are uploaded again", async () => {
    const bytes = await smallSquare();
    const first = await (await POST(await uploadRequest({ bytes, name: "front.jpg" }, { cookie: validCookie() }))).json();
    const response = await POST(await uploadRequest({ bytes, name: "copy.jpg" }, { cookie: validCookie() }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "duplicate", itemId: first.itemId, sha256: first.sha256 });
    expect(itemCount()).toBe(1);
  });

  describe("when the database is locked", () => {
    /** Hold the write lock from a second connection, as a concurrent batch job would. */
    function lockDatabase() {
      const blocker = openDb(join(dataDir, "revenant.db"));
      migrate(blocker);
      blocker.exec("BEGIN IMMEDIATE");
      return blocker;
    }

    it("retries once after 50 ms and returns 503 BUSY if still locked", async () => {
      const blocker = lockDatabase();
      const started = Date.now();
      const response = await POST(
        await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: validCookie() }),
      );
      blocker.exec("ROLLBACK");
      blocker.close();

      expect(response.status).toBe(503);
      expect((await response.json()).error.code).toBe("BUSY");
      expect(Date.now() - started).toBeGreaterThanOrEqual(45);
      expect(itemCount()).toBe(0);
    });

    it("succeeds on the retry when the lock is released within 50 ms", async () => {
      const blocker = lockDatabase();
      const request = await uploadRequest({ bytes: await smallSquare(), name: "front.jpg" }, { cookie: validCookie() });
      // Released after the first attempt (a 200 px normalise takes a few ms) and before the 50 ms retry.
      setTimeout(() => {
        blocker.exec("ROLLBACK");
        blocker.close();
      }, 30);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect((await response.json()).status).toBe("queued");
    });
  });
});
