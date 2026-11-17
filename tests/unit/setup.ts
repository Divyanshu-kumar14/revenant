import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Every unit test run gets its own data directory so parallel files cannot
// share a SQLite database or upload folder.
process.env.REVENANT_DATA_DIR ??= mkdtempSync(join(tmpdir(), "revenant-test-"));
process.env.EXTRACTOR = "fixture";
process.env.ADMIN_PASSWORD ??= "test-password";
process.env.SESSION_SECRET ??= "test-secret-not-used-in-production";

// A unit test that reaches the network is a bug: the extractor is replayed from
// recorded fixtures. Fail loudly instead of silently depending on a provider.
globalThis.fetch = (() => {
  throw new Error(
    "Unit tests must not perform network I/O. Use a fixture, or stub fetch explicitly.",
  );
}) as typeof fetch;
