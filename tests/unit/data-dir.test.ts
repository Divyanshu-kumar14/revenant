import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataDirError, ensureDataDir } from "@/data-dir";
import { register } from "@/instrumentation";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "revenant-datadir-"));
});

afterEach(() => {
  // A test may have made root read-only; restore it so the cleanup can delete it.
  chmodSync(root, 0o700);
  rmSync(root, { recursive: true, force: true });
  root = "";
});

/** Run `fn` and return what it threw, failing the test if it did not throw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("ensureDataDir", () => {
  it("creates the data directory and uploads/ under a path that does not exist yet", () => {
    const target = join(root, "nested", "data");

    const result = ensureDataDir(target);

    expect(result).toEqual({ dataDir: target, uploadsDir: join(target, "uploads") });
    expect(statSync(result.dataDir).isDirectory()).toBe(true);
    expect(statSync(result.uploadsDir).isDirectory()).toBe(true);
    // The write probes are removed.
    expect(readdirSync(result.dataDir)).toEqual(["uploads"]);
    expect(readdirSync(result.uploadsDir)).toEqual([]);
  });

  it("succeeds when called a second time on the same directory", () => {
    const target = join(root, "data");
    const first = ensureDataDir(target);

    expect(ensureDataDir(target)).toEqual(first);
  });

  it.skipIf(process.getuid?.() === 0)(
    "fails with EACCES and the absolute path when the parent is not writable",
    () => {
      chmodSync(root, 0o500);
      const target = join(root, "data");

      const error = thrown(() => ensureDataDir(target));

      expect(error).toBeInstanceOf(DataDirError);
      expect(error).toMatchObject({ code: "EACCES", path: target });
      expect((error as DataDirError).message).toContain(target);
      expect((error as DataDirError).message).toContain("EACCES");
      expect(existsSync(target)).toBe(false);
    },
  );

  it("fails with a clear message when the target path is a regular file", () => {
    const target = join(root, "data");
    writeFileSync(target, "not a directory");

    const error = thrown(() => ensureDataDir(target));

    expect(error).toBeInstanceOf(DataDirError);
    expect((error as DataDirError).message).toBe(
      `Data directory check failed: ${target} exists but is not a directory.`,
    );
  });
});

describe("instrumentation register()", () => {
  const original = { dir: process.env.REVENANT_DATA_DIR, runtime: process.env.NEXT_RUNTIME };

  afterEach(() => {
    // Assigning undefined to process.env stores the string "undefined", so delete instead.
    if (original.dir === undefined) delete process.env.REVENANT_DATA_DIR;
    else process.env.REVENANT_DATA_DIR = original.dir;
    if (original.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = original.runtime;
  });

  it("creates uploads/ under $REVENANT_DATA_DIR in the Node.js runtime", async () => {
    const target = join(root, "data");
    process.env.REVENANT_DATA_DIR = target;
    process.env.NEXT_RUNTIME = "nodejs";

    await register();

    expect(statSync(join(target, "uploads")).isDirectory()).toBe(true);
  });
});
