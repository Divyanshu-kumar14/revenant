import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MIN_SECRET_LENGTH, Unauthorized, requireAdmin } from "@/auth/session";
import { resolveDataDir } from "@/data-dir";
import { getItem } from "@/db/queries";
import { serverDb } from "@/db/server";

type ErrorCode = "UNAUTHORIZED" | "CONFIG" | "NOT_FOUND";

/**
 * The stored photograph of one item, for the review screen. The file lives under the data
 * directory, outside anything Next serves, so this route is the only way to read it, and it
 * requires an admin session. Responses never carry item text or a path.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    console.error("image route: CONFIG SESSION_SECRET is missing or too short");
    return fail(500, "CONFIG", "The server is not configured for admin sessions.");
  }
  try {
    requireAdmin(request, secret);
  } catch (error) {
    if (error instanceof Unauthorized) return fail(401, "UNAUTHORIZED", error.message);
    throw error;
  }

  const { id } = await ctx.params;
  const dataDir = resolveDataDir();
  const item = getItem(serverDb(dataDir), id);
  if (!item) return fail(404, "NOT_FOUND", "No such photograph.");

  let bytes: Buffer;
  try {
    bytes = await readFile(join(dataDir, item.stored_path));
  } catch {
    console.error(`image route: file missing for item ${id}`);
    return fail(404, "NOT_FOUND", "No such photograph.");
  }
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

function fail(status: number, code: ErrorCode, message: string): Response {
  return Response.json({ status: "error", error: { code, message } }, { status });
}
