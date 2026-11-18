import { z } from "zod";
import { MIN_SECRET_LENGTH, Unauthorized, requireAdmin } from "@/auth/session";
import { DataDirError, resolveDataDir } from "@/data-dir";
import { isBusy, serverDb, withBusyRetry } from "@/db/server";
import { IngestError, MAX_UPLOAD_BYTES, type IngestErrorCode } from "@/ingest/errors";
import { ingestFile, type IngestResult } from "@/ingest/ingest";

/** Room for multipart boundaries, part headers and the caption on top of the file limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const uploadSchema = z.object({
  file: z.instanceof(File, { message: "Choose a photograph to upload." }),
  fileName: z.string().trim().min(1, "The file has no name.").max(255, "The file name is too long."),
  caption: z
    .string()
    .trim()
    .max(2000, "The caption is longer than 2000 characters.")
    .optional()
    .transform((value) => (value ? value : undefined)),
});

type ErrorCode = IngestErrorCode | "UNAUTHORIZED" | "CONFIG" | "LENGTH_REQUIRED" | "INVALID_REQUEST" | "BUSY" | "INTERNAL";

type Body =
  | { status: IngestResult["status"]; itemId: string; sha256: string }
  | { status: "error"; error: { code: ErrorCode; message: string } };

const INGEST_STATUS: Record<IngestErrorCode, number> = {
  TOO_LARGE: 413,
  UNDECODABLE: 422,
  UNSUPPORTED_FORMAT: 422,
  STORE_FAILED: 500,
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    console.error("ingest route: CONFIG SESSION_SECRET is not set");
    return fail(500, "CONFIG", "The server is not configured for admin sessions.");
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(`ingest route: CONFIG SESSION_SECRET is shorter than ${MIN_SECRET_LENGTH} characters`);
    return fail(500, "CONFIG", "The server is not configured for admin sessions.");
  }

  let actor: string;
  try {
    actor = requireAdmin(request, secret).actor;
  } catch (error) {
    if (error instanceof Unauthorized) return fail(401, "UNAUTHORIZED", error.message);
    throw error;
  }

  const declared = Number(request.headers.get("content-length") ?? Number.NaN);
  if (!Number.isInteger(declared) || declared < 0) {
    return fail(411, "LENGTH_REQUIRED", "The upload must declare its size.");
  }
  if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return tooLarge(declared);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "INVALID_REQUEST", "The upload could not be read as a form.");
  }
  const file = form.get("file");
  const parsed = uploadSchema.safeParse({
    file,
    fileName: file instanceof File ? file.name : undefined,
    caption: form.get("caption") ?? undefined,
  });
  if (!parsed.success) {
    return fail(400, "INVALID_REQUEST", parsed.error.issues[0]?.message ?? "The upload is not valid.");
  }

  const { fileName, caption } = parsed.data;
  // The exact size is free here; reject before copying the file into memory twice.
  if (parsed.data.file.size > MAX_UPLOAD_BYTES) return tooLarge(parsed.data.file.size);
  const bytes = Buffer.from(await parsed.data.file.arrayBuffer());
  const dataDir = resolveDataDir();
  const attempt = () => ingestFile({ fileName, bytes, caption, actor }, { db: serverDb(dataDir), dataDir });

  try {
    return ok(await withBusyRetry(attempt));
  } catch (error) {
    if (error instanceof IngestError) {
      if (error.code === "STORE_FAILED") console.error("ingest route: STORE_FAILED");
      return fail(INGEST_STATUS[error.code], error.code, error.message);
    }
    if (isBusy(error)) {
      console.error("ingest route: BUSY after retry");
      return fail(503, "BUSY", "The archive is busy. Try the upload again in a moment.");
    }
    if (error instanceof DataDirError) {
      // Built only from the configured path and the errno code, never from request input.
      console.error(`ingest route: INTERNAL ${error.code} ${error.message}`);
    } else {
      console.error(`ingest route: INTERNAL ${error instanceof Error ? error.name : typeof error}`);
    }
    return fail(500, "INTERNAL", "The upload could not be processed.");
  }
}

function ok(result: IngestResult): Response {
  const body: Body = { status: result.status, itemId: result.itemId, sha256: result.sha256 };
  return Response.json(body, { status: 200 });
}

function tooLarge(bytes: number): Response {
  return fail(413, "TOO_LARGE", `The upload is ${bytes} bytes; the limit is ${MAX_UPLOAD_BYTES} bytes.`);
}

function fail(status: number, code: ErrorCode, message: string): Response {
  const body: Body = { status: "error", error: { code, message } };
  return Response.json(body, { status });
}
