import { rollbackQuietly } from "@/db/client";
import { nextQueuedItem, transitionItem, writeAudit } from "@/db/queries";
import type { ClaimedItem, ExtractDb } from "@/extract/extract-item";

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
    const target = nextQueuedItem(db, itemId);
    if (!target) {
      db.exec("ROLLBACK");
      return null;
    }
    if (transitionItem(db, { id: target.id, from: "queued", to: "extracting", error: null, at }) === 0) {
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
    return target;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}
