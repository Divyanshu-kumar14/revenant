import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Vitest runs from the repository root.
const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

// These assertions protect the hard submission requirements. A judge can
// disqualify the project for a gitignored `.kiro/` or a missing license, so the
// guard runs on every commit instead of on the morning of the deadline.
describe("submission contract", () => {
  it("commits the Kiro directory and never ignores it", () => {
    const gitignore = read(".gitignore");
    const lines = gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"));

    for (const line of lines) {
      expect(line).not.toMatch(/^\/?\.kiro(\/|$)/);
    }

    for (const file of [
      ".kiro/steering/product.md",
      ".kiro/steering/tech.md",
      ".kiro/hooks/typecheck-on-save.json",
      ".kiro/specs/ingest/requirements.md",
      ".kiro/agents/cataloger.md",
      ".kiro/settings/mcp.json",
    ]) {
      expect(existsSync(join(root, file)), `${file} must exist`).toBe(true);
    }
  });

  it("ships an MIT license that GitHub can detect", () => {
    const license = read("LICENSE");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 Divyanshu Kumar");
    expect(JSON.parse(read("package.json")).license).toBe("MIT");
  });

  it("commits .env.example and no real env file", () => {
    expect(existsSync(join(root, ".env.example"))).toBe(true);
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/^\.env\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);
  });
});
