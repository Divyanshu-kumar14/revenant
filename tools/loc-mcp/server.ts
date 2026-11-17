/**
 * Project-local MCP server: Library of Congress photographs.
 *
 * Two read-only tools, used by Kiro while building the fixture set and by the
 * `cataloger` agent when it compares a proposed record with the source
 * catalogue. Everything is defensive: the LOC JSON shape is not a contract, and
 * some networks receive a Cloudflare challenge instead of JSON.
 *
 * Run over stdio: `node tools/loc-mcp/server.ts`
 * Never write to stdout outside the protocol.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const LOC = "https://www.loc.gov";
const USER_AGENT =
  process.env.LOC_USER_AGENT ?? "revenant/0.1 (Kiroween 2026 archive tool)";
const TIMEOUT_MS = 20_000;

export interface LocSearchHit {
  id: string;
  title: string;
  date: string | null;
  rights: string | null;
  url: string | null;
  imageUrl: string | null;
  description: string | null;
}

export interface LocItem {
  id: string;
  title: string;
  date: string | null;
  rights: string | null;
  url: string | null;
  imageUrl: string | null;
  summary: string | null;
  subjects: string[];
  contributors: string[];
  notes: string[];
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function firstString(value: unknown): string | null {
  for (const candidate of asArray(value)) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
    if (
      candidate &&
      typeof candidate === "object" &&
      "title" in candidate &&
      typeof (candidate as { title: unknown }).title === "string"
    ) {
      return (candidate as { title: string }).title.trim();
    }
  }
  return null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function text(value: unknown, limit = 600): string | null {
  const raw = firstString(value);
  if (!raw) return null;
  const cleaned = stripHtml(raw);
  if (cleaned === "") return null;
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}…` : cleaned;
}

async function locJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("json")) {
    const hint = contentType.includes("html")
      ? " The Library of Congress returns an HTML challenge on some networks (Cloudflare). Try from a different network or use already-downloaded fixtures."
      : "";
    throw new Error(
      `Library of Congress request failed: HTTP ${response.status} (${contentType || "no content type"}).${hint}`,
    );
  }

  return response.json();
}

export async function searchLocItems(
  query: string,
  limit = 10,
  fetchImpl: typeof fetch = fetch,
): Promise<LocSearchHit[]> {
  const url = new URL("/photos/", LOC);
  url.searchParams.set("q", query);
  url.searchParams.set("fo", "json");
  url.searchParams.set("c", String(limit));

  const payload = (await locJson(url.toString(), fetchImpl)) as {
    results?: unknown[];
  };

  return (payload.results ?? []).map((raw) => {
    const result = (raw ?? {}) as Record<string, unknown>;
    const images = asArray(result.image_url);
    return {
      id: firstString(result.id) ?? "",
      title: text(result.title, 300) ?? "Untitled",
      date: text(result.date, 80),
      rights: text(result.rights, 300),
      url: firstString(result.url) ?? firstString(result.id),
      imageUrl: typeof images[0] === "string" ? images[0] : null,
      description: text(result.description),
    };
  });
}

function itemUrl(id: string): string {
  if (/^https?:\/\//i.test(id)) return id;
  const trimmed = id.replace(/^\/+|\/+$/g, "");
  if (trimmed.startsWith("item/")) return `${LOC}/${trimmed}/`;
  return `${LOC}/item/${trimmed}/`;
}

export async function getLocItem(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LocItem> {
  const url = new URL(itemUrl(id));
  url.searchParams.set("fo", "json");

  const payload = (await locJson(url.toString(), fetchImpl)) as Record<
    string,
    unknown
  >;
  const item = (payload.item ?? {}) as Record<string, unknown>;
  const resources = asArray(payload.resources) as Array<Record<string, unknown>>;
  const resourceImage = firstString(resources[0]?.image);

  return {
    id: firstString(item.id) ?? firstString(payload.item_url) ?? itemUrl(id),
    title: text(item.title ?? payload.title, 300) ?? "Untitled",
    date: text(item.date ?? payload.date, 80),
    rights: text(payload.rights ?? item.rights, 400),
    url: firstString(payload.item_url) ?? itemUrl(id),
    imageUrl:
      resourceImage ?? firstString(item.image_url) ?? firstString(payload.image_url),
    summary: text(item.summary ?? payload.summary ?? item.description),
    subjects: asArray(item.subjects).flatMap((s) => {
      const value = text(s, 120);
      return value ? [value] : [];
    }),
    contributors: asArray(item.contributor_names).flatMap((c) => {
      const value = text(c, 160);
      return value ? [value] : [];
    }),
    notes: asArray(item.notes).flatMap((n) => {
      const value = text(n, 400);
      return value ? [value] : [];
    }),
  };
}

function asText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function asError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const server = new McpServer({ name: "revenant-loc", version: "0.1.0" });

server.registerTool(
  "search_items",
  {
    title: "Search Library of Congress photographs",
    description:
      "Search the Library of Congress photograph collections. Returns catalogue id, title, date, rights, item URL, image URL and a short description. Use it to find public-domain fixtures.",
    inputSchema: {
      query: z.string().min(1).describe("Search terms, e.g. 'county courthouse 1930'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum results (default 10)"),
    },
  },
  async ({ query, limit }) => {
    try {
      const hits = await searchLocItems(query, limit ?? 10);
      return asText({ query, count: hits.length, results: hits });
    } catch (error) {
      return asError(error);
    }
  },
);

server.registerTool(
  "get_item",
  {
    title: "Fetch one Library of Congress item",
    description:
      "Fetch the catalogue record for one item by LOC id or item URL. Returns title, date, rights, summary, subjects, contributors, notes and an image URL.",
    inputSchema: {
      id: z
        .string()
        .min(1)
        .describe("LOC item id, path, or full https://www.loc.gov/item/... URL"),
    },
  },
  async ({ id }) => {
    try {
      return asText(await getLocItem(id));
    } catch (error) {
      return asError(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("revenant-loc MCP server ready on stdio");
