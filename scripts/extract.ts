import { ensureDataDir, resolveDataDir } from "@/data-dir";
import { migrate, openDb } from "@/db/client";
import { getItem } from "@/db/queries";
import { createExtractor } from "@/extract/extract-item";
import { ExtractionError } from "@/extract/provider";
import { runBatch, type BatchSummary } from "@/jobs/extract";

/**
 * `pnpm extract [--limit=<n>] [--item=<id>]` — the batch entry point. Printing and the exit code
 * live here; claiming, recovering stale claims and extracting live in `runBatch`. No watch mode.
 */

interface Options {
  limit: number;
  itemId?: string;
}

function usage(message: string): never {
  console.error(`extract: ${message}`);
  console.error("usage: pnpm extract [--limit=<n>] [--item=<id>]");
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const options: Options = { limit: Number.POSITIVE_INFINITY };
  for (const arg of argv) {
    if (arg.startsWith("--limit=")) {
      const value = arg.slice("--limit=".length);
      if (!/^\d+$/.test(value)) usage(`--limit must be a non-negative integer, not "${value}"`);
      options.limit = Number(value);
      continue;
    }
    if (arg.startsWith("--item=")) {
      const value = arg.slice("--item=".length).trim();
      if (value === "") usage("--item needs an id");
      options.itemId = value;
      continue;
    }
    usage(`unknown argument "${arg}"`);
  }
  return options;
}

function printSummary(summary: BatchSummary): void {
  for (const outcome of summary.outcomes) {
    if (outcome.status === "extracted") {
      console.log(`extracted ${outcome.itemId} in ${outcome.latencyMs} ms`);
    } else if (outcome.status === "failed") {
      console.log(`failed ${outcome.itemId}: ${outcome.code}`);
    } else {
      console.log(`skipped ${outcome.itemId}: ${outcome.current ?? "missing"}`);
    }
  }
  console.log(
    `requeued ${summary.requeued}, claimed ${summary.claimed}, extracted ${summary.extracted}, ` +
      `failed ${summary.failed}, queued ${summary.queued}`,
  );
}

function buildExtractor() {
  try {
    return createExtractor(process.env);
  } catch (error) {
    // The code is enough: adapter messages can carry endpoints and response bodies.
    if (error instanceof ExtractionError) {
      console.error(`extract: ${error.code}`);
      return null;
    }
    console.error(`extract: ${error instanceof Error ? error.name : typeof error}`);
    return null;
  }
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  // Constructed once, before any claim: a missing key stops the run with every item untouched.
  const extractor = buildExtractor();
  if (!extractor) return 1;

  const dataDir = resolveDataDir();
  ensureDataDir(dataDir);
  const db = openDb();
  try {
    migrate(db);
    const summary = await runBatch({ db, dataDir, extractor, actor: "cli" }, options);

    if (options.itemId !== undefined && summary.claimed === 0) {
      console.log(`item ${options.itemId} is ${getItem(db, options.itemId)?.status ?? "missing"}`);
    }
    printSummary(summary);
    return summary.failed === 0 ? 0 : 1;
  } finally {
    db.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(`extract: ${error instanceof Error ? error.name : typeof error}`);
    process.exit(1);
  });
