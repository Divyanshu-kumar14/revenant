import { z } from "zod";
import { MIN_SECRET_LENGTH, Unauthorized, requireAdmin } from "@/auth/session";
import { DataDirError, resolveDataDir } from "@/data-dir";
import { isBusy, serverDb, withBusyRetry } from "@/db/server";
import { createExtractor } from "@/extract/extract-item";
import { ExtractionError } from "@/extract/provider";
import { runBatch, type BatchSummary } from "@/jobs/extract";

/** One click must be bounded: five extractions is roughly 75 seconds and a known token spend. */
export const MAX_BATCH = 5;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(MAX_BATCH).optional(),
});

type ErrorCode = "UNAUTHORIZED" | "CONFIG" | "INVALID_REQUEST" | "BUSY" | "INTERNAL";

type ErrorBody = { status: "error"; error: { code: ErrorCode; message: string } };

/**
 * Extract already-queued items. The body is optional; `{ "limit": n }` bounds the batch, and an
 * empty body runs `MAX_BATCH`. Returns counts only: no item text, raw output or file path ever
 * appears in a response.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("extract route: CONFIG SESSION_SECRET is not set");
    return fail(500, "CONFIG", "The server is not configured for admin sessions.");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`extract route: CONFIG SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
    return fail(500, "CONFIG", "The server is not configured for admin sessions.");
  }

  let actor: string;
  try {
    actor = requireAdmin(request, secret).actor;
  } catch (error) {
    if (error instanceof Unauthorized) return fail(401, "UNAUTHORIZED", error.message);
    throw error;
  }

  let raw: unknown;
  try {
    raw = await readBody(request);
  } catch {
    return fail(400, "INVALID_REQUEST", "The request body must be JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return fail(400, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "The request is not valid.");
  }
  const limit = parsed.data.limit ?? MAX_BATCH;

  let extractor;
  try {
    extractor = createExtractor(process.env);
  } catch (error) {
    // NO_KEY or CONFIG: the run never starts, so every item is still queued.
    if (error instanceof ExtractionError) {
      console.error(`extract route: CONFIG ${error.code}`);
      return fail(500, "CONFIG", "The extraction service is not configured.");
    }
    console.error(`extract route: INTERNAL ${error instanceof Error ? error.name : typeof error}`);
    return fail(500, "INTERNAL", "The extraction could not start.");
  }

  const dataDir = resolveDataDir();
  const attempt = () =>
    runBatch({ db: serverDb(dataDir), dataDir, extractor, actor }, { limit });

  try {
    const summary: BatchSummary = await withBusyRetry(attempt);
    return Response.json(
      {
        requeued: summary.requeued,
        claimed: summary.claimed,
        extracted: summary.extracted,
        failed: summary.failed,
        queued: summary.queued,
      },
      { status: 200 },
    );
  } catch (error) {
    if (isBusy(error)) {
      console.error("extract route: BUSY after retry");
      return fail(503, "BUSY", "The archive is busy. Try again in a moment.");
    }
    if (error instanceof DataDirError) {
      // Built only from the configured path and the errno code, never from request input.
      console.error(`extract route: INTERNAL ${error.code} ${error.message}`);
    } else {
      console.error(`extract route: INTERNAL ${error instanceof Error ? error.name : typeof error}`);
    }
    return fail(500, "INTERNAL", "The extraction could not be processed.");
  }
}

/** An absent body is an empty object; invalid JSON throws and the caller answers 400. */
async function readBody(request: Request): Promise<unknown> {
  const text = (await request.text()).trim();
  if (text === "") return {};
  return JSON.parse(text);
}

function fail(status: number, code: ErrorCode, message: string): Response {
  const body: ErrorBody = { status: "error", error: { code, message } };
  return Response.json(body, { status });
}
