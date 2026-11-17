/**
 * Build the accuracy fixture set from Wikimedia Commons.
 *
 * The Library of Congress JSON API answers with a Cloudflare challenge (HTTP
 * 403) from some networks, so the set is drawn from Commons DPLA uploads
 * instead: public-domain postcards and photographs whose date is recorded in
 * the file's own metadata. Two classes are fetched on purpose — printed fronts
 * and handwritten versos — because ADR 0001 decides whether the product may
 * promise handwriting at all.
 *
 * One physical item can have several pages (front, back). Candidates are grouped
 * by DPLA identifier and the verso is preferred, so twenty rows mean twenty
 * items, not ten items counted twice. Class is derived from the page title, never
 * assumed from the query that found it.
 *
 * Images are gitignored (reproducible with `pnpm fixtures`); the manifest is
 * committed so a scoring run always refers to the same twenty items.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT =
  "RevenantFixtureFetch/0.1 (archive accuracy fixtures; https://github.com/Divyanshu-kumar14/revenant)";
const OUT_DIR = path.join("fixtures", "spike");
const IMAGE_DIR = path.join(OUT_DIR, "images");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const TARGET = 20;
const MAX_HANDWRITTEN = 10;
const MAX_BYTES = 8_000_000;
const MIN_WIDTH = 900;
const THUMB_WIDTH = "1200";

const QUERIES = [
  'filetype:bitmap DPLA postcard "page 2"',
  "filetype:bitmap DPLA postcard with message",
  "filetype:bitmap DPLA photograph inscription",
  "filetype:bitmap DPLA postcard 1910",
  "filetype:bitmap DPLA postcard 1912",
];

interface CommonsPage {
  pageid: number;
  title: string;
  imageinfo?: Array<{
    url: string;
    thumburl?: string;
    width: number;
    height: number;
    extmetadata?: Record<string, { value?: unknown }>;
  }>;
}

type PageInfo = NonNullable<CommonsPage["imageinfo"]>[number];

export interface FixtureItem {
  id: string;
  /** One identifier per physical item, so a front and its verso count once. */
  key: string;
  pageId: number;
  class: "verso-handwritten" | "front-printed";
  commonsTitle: string;
  referenceTitle: string;
  referenceDate: string | null;
  referenceYear: number | null;
  referenceDescription: string | null;
  license: string;
  pageUrl: string;
  sourceUrl: string;
  file: string;
  bytes: number;
  width: number;
  height: number;
}

interface Candidate {
  page: CommonsPage;
  info: PageInfo;
  key: string;
  handwritten: boolean;
  year: number;
  license: string;
}

async function commons(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Commons API ${response.status} for ${params.list ?? params.prop ?? "request"}`);
  }
  return response.json();
}

async function search(query: string): Promise<string[]> {
  const payload = (await commons({
    action: "query",
    format: "json",
    formatversion: "2",
    list: "search",
    srnamespace: "6",
    srlimit: "100",
    srsearch: query,
  })) as { query?: { search?: Array<{ title: string }> } };

  return (payload.query?.search ?? []).map((entry) => entry.title);
}

async function imageInfo(titles: string[]): Promise<CommonsPage[]> {
  // 100 titles in one query string exceeds the server's URL limit (HTTP 414).
  const pages: CommonsPage[] = [];
  for (let index = 0; index < titles.length; index += 20) {
    const chunk = titles.slice(index, index + 20);
    const payload = (await commons({
      action: "query",
      format: "json",
      formatversion: "2",
      titles: chunk.join("|"),
      prop: "imageinfo",
      iiprop: "url|extmetadata|size",
      iiurlwidth: THUMB_WIDTH,
    })) as { query?: { pages?: CommonsPage[] } };
    pages.push(...(payload.query?.pages ?? []));
  }
  return pages;
}

function stripHtml(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function yearIn(text: string): number | null {
  const match = text.match(/\b(1[89]\d{2}|20[0-2]\d)\b/);
  return match ? Number(match[1]) : null;
}

function itemKey(title: string, pageId: number): string {
  const dpla = title.match(/- DPLA - ([0-9a-z]{8,})/i);
  return dpla ? dpla[1].toLowerCase() : `page-${pageId}`;
}

/** A page is handwritten only if its own title says so. */
function isHandwritten(title: string): boolean {
  if (/\(verso\)/i.test(title)) return true;
  const page = title.match(/\(page\s+(\d+)\)/i);
  return page ? Number(page[1]) > 1 : false;
}

async function download(url: string, destination: string): Promise<{ bytes: number; ext: string }> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`image download ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`not an image (${contentType || "unknown type"})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`too large (${buffer.byteLength} bytes)`);
  }
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  await writeFile(`${destination}.${ext}`, buffer);
  return { bytes: buffer.byteLength, ext };
}

async function collect(): Promise<Candidate[]> {
  const candidates = new Map<string, Candidate>();

  for (const query of QUERIES) {
    console.error(`searching: ${query}`);
    const titles = await search(query);
    const pages = await imageInfo(titles);

    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      if (info.width < MIN_WIDTH) continue;

      const license = stripHtml(info.extmetadata?.LicenseShortName?.value);
      if (!/^(public domain|pd\b|pd-|cc0)/i.test(license)) continue;

      const year = yearIn(page.title);
      if (year === null) continue;

      const key = itemKey(page.title, page.pageid);
      const handwritten = isHandwritten(page.title);

      // Prefer the verso when an item has both pages; keep one row per key.
      const existing = candidates.get(key);
      if (existing && (existing.handwritten || !handwritten)) continue;

      candidates.set(key, { page, info, key, handwritten, year, license });
    }
  }

  return [...candidates.values()].sort((left, right) => {
    if (left.handwritten !== right.handwritten) return left.handwritten ? -1 : 1;
    return left.key.localeCompare(right.key);
  });
}

async function main(): Promise<void> {
  await mkdir(IMAGE_DIR, { recursive: true });
  const candidates = await collect();
  console.error(`\n${candidates.length} distinct items, ${candidates.filter((c) => c.handwritten).length} handwritten\n`);

  const items: FixtureItem[] = [];
  let handwritten = 0;

  for (const candidate of candidates) {
    if (items.length >= TARGET) break;
    if (candidate.handwritten && handwritten >= MAX_HANDWRITTEN) continue;

    const { page, info, key, year, license } = candidate;
    const base = path.join(IMAGE_DIR, String(page.pageid));

    let stored: { bytes: number; ext: string };
    try {
      stored = await download(info.thumburl ?? info.url, base);
    } catch (error) {
      console.error(`  skip ${page.pageid}: ${error instanceof Error ? error.message : error}`);
      continue;
    }

    items.push({
      id: `spike-${page.pageid}`,
      key,
      pageId: page.pageid,
      class: candidate.handwritten ? "verso-handwritten" : "front-printed",
      commonsTitle: page.title,
      referenceTitle: stripHtml(info.extmetadata?.ObjectName?.value) || page.title,
      referenceDate: stripHtml(info.extmetadata?.DateTimeOriginal?.value) || String(year),
      referenceYear: year,
      referenceDescription: stripHtml(info.extmetadata?.ImageDescription?.value) || null,
      license,
      pageUrl: `https://commons.wikimedia.org/?curid=${page.pageid}`,
      sourceUrl: info.thumburl ?? info.url,
      file: path.join(IMAGE_DIR, `${page.pageid}.${stored.ext}`),
      bytes: stored.bytes,
      width: info.width,
      height: info.height,
    });

    if (candidate.handwritten) handwritten += 1;
    console.error(`  + ${page.pageid} (${candidate.handwritten ? "verso" : "front"}, ${year}, ${stored.bytes} bytes)`);
  }

  if (items.length < TARGET) {
    throw new Error(`only ${items.length} usable fixtures found, need ${TARGET}`);
  }

  await writeFile(
    MANIFEST,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Wikimedia Commons, DPLA uploads (public domain)",
        note: "referenceDate/referenceTitle are the archive's own metadata, not a transcription. Class is derived from the page title; confirm it while scoring. Scoring is manual: docs/decisions/0001-extraction-promise.md.",
        items,
      },
      null,
      2,
    )}\n`,
  );

  console.error(`\nwrote ${MANIFEST}: ${items.length} items (${handwritten} handwritten, ${items.length - handwritten} printed)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
