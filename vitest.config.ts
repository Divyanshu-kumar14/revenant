import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": src },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Unit tests must never reach the network: the extractor is replayed from
    // fixtures and every other dependency is local. A test that needs a real
    // provider belongs in the eval harness, not here.
    setupFiles: ["tests/unit/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/app/**", "src/components/**"],
      reporter: ["text", "json-summary"],
    },
  },
});
