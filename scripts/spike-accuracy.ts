/**
 * Run the extraction prompt over the fixture set and print what came back.
 *
 * This script deliberately computes no score. ADR 0001 is scored by a person
 * reading each image next to the model's output; an automatic "accuracy %" from
 * string matching would be a number nobody could defend.
 *
 *   pnpm spike                 # all items
 *   pnpm spike -- --limit=3    # smoke test, three items
 *   pnpm spike -- --only=spike-173419891
 *   pnpm spike -- --provider=nim --model=<nim model id>   # default provider is gemini
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ExtractionError,
  GeminiExtractor,
  type Extraction,
  type Extractor,
} from "../src/extract/provider.ts";
import { NimExtractor } from "../src/extract/nim.ts";
import { EXTRACTION_PROMPT, PROMPT_VERSION } from "../src/extract/prompt.ts";
import type { FixtureItem } from "./fetch-fixtures.ts";

interface Manifest {
  generatedAt: string;
  source: string;
  items: FixtureItem[];
}

interface ItemResult {
  id: string;
  class: FixtureItem["class"];
  file: string;
  pageUrl: string;
  reference: {
    title: string;
    date: string | null;
    year: number | null;
    description: string | null;
  };
  extraction: Extraction | null;
  error: { code: string; message: string } | null;
  ms: number;
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function truncate(text: string | null, length = 150): string {
  if (text === null) return "—";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1)}…` : flat;
}

function entities(list: Array<{ name: string; confidence: number }>): string {
  if (list.length === 0) return "—";
  return list.map((entry) => `${entry.name} (${entry.confidence.toFixed(2)})`).join(", ");
}

function print(record: ItemResult, index: number, total: number): void {
  const { extraction } = record;
  console.log(`\n── ${String(index).padStart(2, "0")}/${total}  ${record.id}  [${record.class}]`);
  console.log(`   image      ${record.file}`);
  console.log(`   source     ${record.pageUrl}`);
  console.log(`   reference  ${record.reference.title}`);
  console.log(`              date: ${record.reference.date ?? "—"}   year: ${record.reference.year ?? "—"}`);

  if (!extraction) {
    console.log(`   ERROR      ${record.error?.code}: ${record.error?.message}`);
    return;
  }

  const date = extraction.date;
  const bounds = date.start && date.end ? `${date.start}..${date.end}` : "—";
  console.log(
    `   model date ${date.display ?? "—"}   precision: ${date.precision}   bounds: ${bounds}   conf: ${(extraction.confidence.date ?? 0).toFixed(2)}`,
  );
  console.log(`   title      ${truncate(extraction.title, 120)}`);
  console.log(`   people     ${entities(extraction.people)}`);
  console.log(`   places     ${entities(extraction.places)}`);
  console.log(`   subjects   ${entities(extraction.subjects)}`);
  console.log(`   transcr.   ${truncate(extraction.transcription)}`);
  console.log(`   elapsed    ${record.ms} ms`);
}

type ProviderName = "gemini" | "nim";

function parseProvider(value: string | undefined): ProviderName {
  if (value === undefined || value === "gemini") return "gemini";
  if (value === "nim") return "nim";
  throw new ExtractionError("CONFIG", `unknown --provider=${value}; expected gemini or nim`);
}

function buildExtractor(provider: ProviderName): Extractor {
  if (provider === "nim") {
    // NimExtractor reads NVIDIA_API_KEY / NVAPI_API_KEY, NIM_MODEL and VISION_BASE_URL itself.
    return new NimExtractor({
      prompt: EXTRACTION_PROMPT,
      promptVersion: PROMPT_VERSION,
      model: flag("model"),
    });
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.VISION_API_KEY ?? "";
  if (!apiKey) {
    throw new ExtractionError(
      "NO_KEY",
      "no key found. Put GEMINI_API_KEY=… in .env.local at the repo root, or export it for one run.",
    );
  }
  return new GeminiExtractor({
    apiKey,
    prompt: EXTRACTION_PROMPT,
    promptVersion: PROMPT_VERSION,
    model: flag("model") ?? process.env.VISION_MODEL,
    baseUrl: process.env.VISION_BASE_URL,
  });
}

async function main(): Promise<void> {
  const provider = parseProvider(flag("provider"));
  const extractor = buildExtractor(provider);

  const manifestPath = path.join("fixtures", "spike", "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error(`${manifestPath} has no items. Run: pnpm fixtures`);
  }

  const only = flag("only");
  const limit = Number(flag("limit") ?? manifest.items.length);
  const selected = manifest.items
    .filter((item) => (only ? item.id === only : true))
    .slice(0, Number.isFinite(limit) ? limit : manifest.items.length);

  if (selected.length === 0) {
    throw new Error(`no fixture matched --only=${only}`);
  }

  console.error(
    `provider ${provider} · model ${extractor.model} · prompt ${extractor.promptVersion} · ${selected.length} items\n`,
  );

  const startedAt = new Date().toISOString();
  const records: ItemResult[] = [];

  for (const [index, item] of selected.entries()) {
    const began = Date.now();
    try {
      const image = await readFile(item.file);
      const extraction = await extractor.extract({ image, mimeType: "image/jpeg" });
      const record: ItemResult = {
        id: item.id,
        class: item.class,
        file: item.file,
        pageUrl: item.pageUrl,
        reference: {
          title: item.referenceTitle,
          date: item.referenceDate,
          year: item.referenceYear,
          description: item.referenceDescription,
        },
        extraction,
        error: null,
        ms: Date.now() - began,
      };
      records.push(record);
      print(record, index + 1, selected.length);
    } catch (error) {
      const record: ItemResult = {
        id: item.id,
        class: item.class,
        file: item.file,
        pageUrl: item.pageUrl,
        reference: {
          title: item.referenceTitle,
          date: item.referenceDate,
          year: item.referenceYear,
          description: item.referenceDescription,
        },
        extraction: null,
        error:
          error instanceof ExtractionError
            ? { code: error.code, message: error.message }
            : { code: "UNKNOWN", message: error instanceof Error ? error.message : String(error) },
        ms: Date.now() - began,
      };
      records.push(record);
      print(record, index + 1, selected.length);
    }
  }

  await mkdir("eval-runs", { recursive: true });
  const stamp = startedAt.replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const outPath = path.join("eval-runs", `spike-${stamp}.json`);
  await writeFile(
    outPath,
    `${JSON.stringify(
      {
        kind: "accuracy-spike",
        provider,
        model: extractor.model,
        promptVersion: extractor.promptVersion,
        startedAt,
        finishedAt: new Date().toISOString(),
        source: manifest.source,
        records,
      },
      null,
      2,
    )}\n`,
  );

  const ok = records.filter((record) => record.extraction).length;
  const failed = records.length - ok;
  console.error(`\n${ok} extracted, ${failed} failed → ${outPath}`);
  console.error("No score was computed. Score by hand in docs/decisions/0001-extraction-promise.md.");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof ExtractionError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exitCode = 1;
});
