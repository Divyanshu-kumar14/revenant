import { writeAudit } from "@/db/queries";
import { rollback, type ClaimedItem, type ExtractDb } from "@/extract/extract-item";

/**
 * Moves one queued item to `extracting` and writes its `extract_started` audit row, in one
 * `BEGIN IMMEDIATE` transaction so two runs serialise on the write lock and only one wins.
 * With `itemId`, claims that item only if it is queued; otherwise claims the oldest queued item.
 * Returns null, writing nothing, when there is nothing to claim or another run got there first.
 */
export function claim(db: ExtractDb, actor: string, now: Date, itemId?: string): ClaimedItem | null {
  const at = now.toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const target = (
      itemId === undefined
        ? db
            .prepare("SELECT id, stored_path FROM items WHERE status = 'queued' ORDER BY created_at, id LIMIT 1")
            .get()
        : db.prepare("SELECT id, stored_path FROM items WHERE id = ? AND status = 'queued'").get(itemId)
    ) as { id: string; stored_path: string } | undefined;
    if (!target) {
      db.exec("ROLLBACK");
      return null;
    }
    const moved = db
      .prepare("UPDATE items SET status = 'extracting', updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(at, target.id);
    if (Number(moved.changes) === 0) {
      db.exec("ROLLBACK");
      return null;
    }
    writeAudit(db, {
      itemId: target.id,
      actor,
      action: "extract_started",
      before: { status: "queued" },
      after: { status: "extracting" },
      at,
    });
    db.exec("COMMIT");
    return { id: target.id, storedPath: target.stored_path };
  } catch (error) {
    rollback(db);
    throw error;
  }
}
