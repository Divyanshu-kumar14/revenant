import { z } from "zod";

import { EXTRACTION_PROMPT, PROMPT_VERSION } from "./prompt.ts";
import {
  ExtractionError,
  extractJsonObject,
  extractionSchema,
  type Extraction,
  type ExtractionResult,
  type ExtractInput,
  type Extractor,
} from "./provider.ts";

/**
 * NVIDIA NIM adapter. NIM speaks the OpenAI chat-completions dialect, so images
 * go as `image_url` parts holding a base64 data URI. The Gemini adapter in
 * provider.ts is untouched; the small JSON helpers below are copies on purpose, except
 * `extractJsonObject`, which is shared from provider.ts so `deriveProposal` parses the same way.
 */

export interface NimOptions {
  /** Defaults to NVIDIA_API_KEY, then NVAPI_API_KEY. */
  apiKey?: string;
  /** Defaults to NIM_MODEL, then DEFAULT_MODEL. */
  model?: string;
  /** Defaults to VISION_BASE_URL, then DEFAULT_BASE_URL. */
  baseUrl?: string;
  prompt?: string;
  promptVersion?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
// Picked from the live catalog (GET /v1/models) on 2026-11-18; "vl" = vision-language.
const DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 30_000;

export const NIM_KEY_NAMES = ["NVIDIA_API_KEY", "NVAPI_API_KEY"] as const;

export function resolveNimKey(env: NodeJS.ProcessEnv = process.env): string {
  return env.NVIDIA_API_KEY || env.NVAPI_API_KEY || "";
}

interface ChatCompletion {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> | null };
  }>;
}

export class NimExtractor implements Extractor {
  readonly model: string;
  readonly promptVersion: string;
  private readonly apiKey: string;
  private readonly prompt: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NimOptions = {}) {
    const apiKey = options.apiKey ?? resolveNimKey();
    if (!apiKey) {
      throw new ExtractionError(
        "NO_KEY",
        `${NIM_KEY_NAMES[0]} is not set (${NIM_KEY_NAMES[1]} is accepted as an alias)`,
      );
    }
    this.apiKey = apiKey;
    this.prompt = options.prompt ?? EXTRACTION_PROMPT;
    this.promptVersion = options.promptVersion ?? PROMPT_VERSION;
    this.model = options.model || process.env.NIM_MODEL || DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl || process.env.VISION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;

    // .env.example sets VISION_BASE_URL to the Gemini endpoint; sending a NIM key there would leak it.
    if (new URL(this.baseUrl).hostname.endsWith("googleapis.com")) {
      throw new ExtractionError(
        "CONFIG",
        "VISION_BASE_URL points at Google; unset it or set it to the NIM endpoint for --provider=nim",
      );
    }
  }

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const dataUri = `data:${input.mimeType};base64,${input.image.toString("base64")}`;
    const first = await this.complete([
      {
        role: "user",
        content: [
          { type: "text", text: this.prompt },
          { type: "image_url", image_url: { url: dataUri } },
        ],
      },
    ]);

    try {
      return { extraction: validate(first), raw: first, repaired: false, coerced: false };
    } catch (error) {
      const repaired = await this.complete([
        {
          role: "user",
          content: [
            "Your previous response did not match the required JSON schema.",
            `Errors: ${describeError(error)}`,
            "Previous response:",
            first.slice(0, 4000),
            "Return only the corrected JSON object, with the same content but valid field types.",
          ].join("\n"),
        },
      ]);
      try {
        return { extraction: validate(repaired), raw: repaired, repaired: true, coerced: false };
      } catch (secondError) {
        // Last resort, only after the repair call also failed: salvage a malformed
        // date or null list instead of losing the transcription. A coerced date is
        // marked by confidence.date = 0 so review sees it was not read from the item.
        let salvaged: Extraction;
        try {
          salvaged = coerceExtraction(repaired);
        } catch {
          throw new ExtractionError(
            "SCHEMA",
            `model output failed validation twice: ${describeError(secondError)}`,
          );
        }
        return { extraction: salvaged, raw: repaired, repaired: true, coerced: true };
      }
    }
  }

  /** Up to MAX_ATTEMPTS tries; retries only rate limits, 5xx, timeouts and network faults. */
  private async complete(messages: unknown[]): Promise<string> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.completeOnce(messages);
      } catch (error) {
        if (attempt >= MAX_ATTEMPTS || !isTransient(error)) throw error;
        await sleep(backoffMs(error, attempt));
      }
    }
  }

  private async completeOnce(messages: unknown[]): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          max_tokens: 4096,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new NimError("TIMEOUT", `NIM request exceeded ${this.timeoutMs} ms`);
      }
      throw new NimError(
        "PROVIDER",
        `NIM request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 400);
      const code =
        response.status === 401 || response.status === 403
          ? "AUTH"
          : response.status === 429
            ? "RATE_LIMIT"
            : response.status >= 500
              ? "PROVIDER"
              : "HTTP";
      throw new NimError(
        code,
        `NIM ${response.status}: ${body}`,
        response.status,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    let payload: ChatCompletion;
    try {
      payload = (await response.json()) as ChatCompletion;
    } catch {
      throw new ExtractionError("PROVIDER", "NIM returned a non-JSON response body");
    }

    const choice = payload.choices?.[0];
    if (choice?.finish_reason === "content_filter") {
      throw new ExtractionError("BLOCKED", "NIM blocked the response (content_filter)");
    }

    const content = choice?.message?.content;
    const text = (
      typeof content === "string"
        ? content
        : (content ?? []).map((part) => part.text ?? "").join("")
    ).trim();

    if (!text) {
      throw new ExtractionError("PROVIDER", "NIM returned no text");
    }
    return text;
  }
}

/** ExtractionError that also carries the server's Retry-After, in milliseconds. */
class NimError extends ExtractionError {
  readonly retryAfterMs?: number;

  constructor(
    code: ExtractionError["code"],
    message: string,
    status?: number,
    retryAfterMs?: number,
  ) {
    super(code, message, status);
    this.retryAfterMs = retryAfterMs;
  }
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ExtractionError)) return false;
  if (error.status !== undefined) return error.status === 429 || error.status >= 500;
  return error.code === "TIMEOUT" || (error.code === "PROVIDER" && error.message.startsWith("NIM request failed"));
}

function backoffMs(error: unknown, attempt: number): number {
  const requested = error instanceof NimError ? error.retryAfterMs : undefined;
  return Math.min(requested ?? 1500 * attempt, MAX_RETRY_AFTER_MS);
}

/** Retry-After is delta-seconds or an HTTP date. Returns undefined when absent or unusable. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validate(text: string): Extraction {
  return extractionSchema.parse(JSON.parse(extractJsonObject(text)));
}

const LIST_KEYS = ["people", "places", "subjects"] as const;

/**
 * Re-validates a response whose only faults are a missing/invalid `date` or
 * null/non-array entity lists. Any other fault still throws, so content errors
 * are never hidden. A coerced date becomes unknown with confidence.date = 0.
 *
 * Exported so the proposal derived from a stored raw response can repeat the exact
 * salvage the adapter applied; it needs no extractor, key or network.
 */
export function coerceExtraction(text: string): Extraction {
  const parsed: unknown = JSON.parse(extractJsonObject(text));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("response is not a JSON object");
  }
  const patched: Record<string, unknown> = { ...parsed };

  for (const key of LIST_KEYS) {
    if (!Array.isArray(patched[key])) patched[key] = [];
  }

  const confidence =
    typeof patched.confidence === "object" && patched.confidence !== null && !Array.isArray(patched.confidence)
      ? { ...(patched.confidence as Record<string, unknown>) }
      : {};
  patched.confidence = confidence;

  if (!dateSchema.safeParse(patched.date).success) {
    patched.date = { display: rawDateText(patched.date), start: null, end: null, precision: "unknown" };
    confidence.date = 0;
  }

  return extractionSchema.parse(patched);
}

const dateSchema = extractionSchema.shape.date;

/** The date as the model wrote it, if it wrote text; otherwise null. */
function rawDateText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && value !== null && "display" in value) {
    const display = (value as { display?: unknown }).display;
    return typeof display === "string" ? display.trim() || null : null;
  }
  return null;
}


function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
