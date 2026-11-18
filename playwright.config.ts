import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Not 3000, so a developer's running server (with their own secret and data) is never reused.
const PORT = 3100;
// At least 32 characters, the floor src/auth/session.ts enforces.
const SESSION_SECRET = "e2e-secret-not-real-padded-to-32-chars";

// Playwright loads this file in the runner and again in every worker. Workers inherit the
// runner's environment, so the temp directory is created once and shared.
const dataDir =
  process.env.REVENANT_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "revenant-e2e-"));
process.env.REVENANT_E2E_DATA_DIR = dataDir;
// Specs read the secret from here to mint a session cookie.
process.env.SESSION_SECRET = SESSION_SECRET;
// Ingest writes to <dataDir>/uploads with `wx`; until ingest Task 9's startup guard exists,
// the directory has to be created before the first upload.
mkdirSync(join(dataDir, "uploads"), { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["dot"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // pnpm 10 forwards a literal `--` to next, which then reads `-p` as a directory.
    command: `pnpm dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { SESSION_SECRET, REVENANT_DATA_DIR: dataDir },
  },
});
