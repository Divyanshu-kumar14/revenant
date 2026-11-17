import { z } from "zod";

/**
 * Extraction contract shared by the provider adapter, the batch runner and the
 * accuracy spike. Field names match .kiro/steering/archive-conventions.md.
 */

export const PRECISIONS = [
  "day",
  "month",
  "year",
  "decade",
  "season",
  "circa",
  "range",
  "before",
  "after",
  "unknown",
] as const;

export type Precision = (typeof PRECISIONS)[number];

const confidenceSchema = z.number().min(0).max(1);

/** Empty strings from a model are absence, not content. */
const nullableText = z
  .string()
  .nullish()
  .transform((value) => (value == null || value.trim() === "" ? null : value.trim()));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullish()
  .transform((value) => value ?? null);

export const extractedEntitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  confidence: confidenceSchema.nullish().transform((value) => value ?? 0),
});

export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

export const extractionSchema = z.object({
  transcription: nullableText,
  title: nullableText,
  description: nullableText,
  date: z.object({
    display: nullableText,
    start: isoDate,
    end: isoDate,
    precision: z.enum(PRECISIONS),
  }),
  people: z.array(extractedEntitySchema).max(50).default([]),
  places: z.array(extractedEntitySchema).max(50).default([]),
  subjects: z.array(extractedEntitySchema).max(20).default([]),
  confidence: z.record(z.string(), confidenceSchema).default({}),
});

export type Extraction = z.infer<typeof extractionSchema>;

export type ExtractionErrorCode =
  | "NO_KEY"
  | "AUTH"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "HTTP"
  | "SCHEMA"
  | "PROVIDER"
  | "BLOCKED"
  | "CONFIG";

export class ExtractionError extends Error {
  // Declared rather than parameter properties: Node runs these files directly
  // with type stripping, which erases declarations but cannot generate the
  // assignments that parameter properties imply.
  readonly code: ExtractionErrorCode;
  readonly status?: number;

  constructor(code: ExtractionErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
    this.status = status;
  }
}

export interface ExtractInput {
  image: Buffer;
  mimeType: string;
}

export interface Extractor {
  readonly model: string;
  readonly promptVersion: string;
  extract(input: ExtractInput): Promise<Extraction>;
}

export interface GeminiOptions {
  apiKey: string;
  prompt: string;
  promptVersion: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.8-flash";

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

/**
 * Gemini's native generateContent endpoint. A one-file module on purpose: the
 * spike scripts import it directly under Node, which needs explicit specifiers.
 */
export class GeminiExtractor implements Extractor {
  readonly model: string;
  readonly promptVersion: string;
  private readonly apiKey: string;
  private readonly prompt: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiOptions) {
    if (!options.apiKey) {
      throw new ExtractionError("NO_KEY", "GEMINI_API_KEY or VISION_API_KEY is not set");
    }
    this.apiKey = options.apiKey;
    this.prompt = options.prompt;
    this.promptVersion = options.promptVersion;
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async extract(input: ExtractInput): Promise<Extraction> {
    const first = await this.generate([
      {
        inline_data: {
          mime_type: input.mimeType,
          data: input.image.toString("base64"),
        },
      },
      { text: this.prompt },
    ]);

    try {
      return validate(first);
    } catch (error) {
      const issues = describeError(error);
      const repaired = await this.generate([
        {
          text: [
            "Your previous response did not match the required JSON schema.",
            `Errors: ${issues}`,
            "Previous response:",
            first.slice(0, 4000),
            "Return only the corrected JSON object, with the same content but valid field types.",
          ].join("\n"),
        },
      ]);
      try {
        return validate(repaired);
      } catch (secondError) {
        throw new ExtractionError(
          "SCHEMA",
          `model output failed validation twice: ${describeError(secondError)}`,
        );
      }
    }
  }

  /** Retries only what is worth retrying: overload, rate limits, timeouts. */
  private async generate(parts: GeminiPart[], attempt = 1): Promise<string> {
    try {
      return await this.generateOnce(parts);
    } catch (error) {
      if (attempt >= 3 || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      return this.generate(parts, attempt + 1);
    }
  }

  private async generateOnce(parts: GeminiPart[]): Promise<string> {
    const url = `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`;
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        throw new ExtractionError("TIMEOUT", `Gemini request exceeded ${this.timeoutMs} ms`);
      }
      throw new ExtractionError(
        "PROVIDER",
        `Gemini request failed: ${error instanceof Error ? error.message : String(error)}`,
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
      throw new ExtractionError(code, `Gemini ${response.status}: ${body}`, response.status);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };

    if (payload.promptFeedback?.blockReason) {
      throw new ExtractionError("BLOCKED", `Gemini blocked the request: ${payload.promptFeedback.blockReason}`);
    }

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new ExtractionError("PROVIDER", "Gemini returned no text");
    }
    return text;
  }
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ExtractionError)) return false;
  if (error.status !== undefined) {
    return error.status === 429 || error.status >= 500;
  }
  return error.code === "TIMEOUT" || (error.code === "PROVIDER" && error.message.startsWith("Gemini request failed"));
}

function validate(text: string): Extraction {
  return extractionSchema.parse(JSON.parse(extractJsonObject(text)));
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object found in the response");
  }
  return body.slice(start, end + 1);
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
