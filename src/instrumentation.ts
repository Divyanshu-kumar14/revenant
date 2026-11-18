/**
 * Called once by Next.js when a server instance starts, before it serves requests.
 * A data directory that cannot be created or written stops the server from booting.
 * The ingest route runs the same check on its first request, so correctness does not
 * depend on this hook.
 */
export async function register(): Promise<void> {
  // The edge runtime has no filesystem; only the Node.js server owns the data directory.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Imported here so the edge build of this file never pulls in node:fs.
  const { ensureDataDir, resolveDataDir } = await import("@/data-dir");
  try {
    const { dataDir } = ensureDataDir(resolveDataDir());
    console.info(`instrumentation: data directory ready at ${dataDir}`);
  } catch (error) {
    console.error(`instrumentation: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}
