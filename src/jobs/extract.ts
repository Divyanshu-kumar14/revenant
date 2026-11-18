import { rollbackQuietly } from "@/db/client";
import {
  countItemsWithStatus,
  nextQueuedItem,
  staleExtractingItems,
  transitionItem,
  writeAudit,
} from "@/db/queries";
import { extractClaimed, type ClaimedItem, type ExtractDb, type ExtractDeps, type ExtractOutcome } from "@/extract/extract-item";

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

/**
 * A claim older than this is presumed dead. One live claim can take at most 480 s (two model calls,
 * three attempts each, 60 s timeout and 30 s backoff), so fifteen minutes never requeues work still
 * in progress.
 */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface BatchSummary {
  requeued: number;
  claimed: number;
  extracted: number;
  failed: number;
  queued: number;
  outcomes: ExtractOutcome[];
}

/**
 * Return items left `extracting` for more than fifteen minutes to `queued`, writing one
 * `extract_interrupted` audit row each. This catches a claim whose process died between the claim
 * and the finish, which no catch block can. Returns the requeued ids.
 */
export function requeueStale(db: ExtractDb, actor: string, now: Date): string[] {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const requeued: string[] = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const stale of staleExtractingItems(db, cutoff)) {
      if (transitionItem(db, { id: stale.id, from: "extracting", to: "queued", error: null, at }) === 0) {
        continue;
      }
      writeAudit(db, {
        itemId: stale.id,
        actor,
        action: "extract_interrupted",
        before: { status: "extracting", since: stale.updatedAt },
        after: { status: "queued" },
        at,
      });
      requeued.push(stale.id);
    }
    db.exec("COMMIT");
    return requeued;
  } catch (error) {
    rollbackQuietly(db);
    throw error;
  }
}

/**
 * Drain the queue: recover stale claims once, then claim and extract oldest-first until the limit
 * is reached or nothing is claimable. With `itemId`, only that item is a candidate; when it is not
 * queued nothing is claimed and `outcomes` stays empty. `queued` is the count left behind.
 */
export async function runBatch(
  deps: ExtractDeps,
  options: { limit: number; itemId?: string },
): Promise<BatchSummary> {
  const clock = deps.now ?? (() => new Date());
  const requeued = requeueStale(deps.db, deps.actor, clock());
  const outcomes: ExtractOutcome[] = [];
  let claimed = 0;
  let extracted = 0;
  let failed = 0;

  while (claimed < options.limit) {
    const item = claim(deps.db, deps.actor, clock(), options.itemId);
    if (!item) break;
    claimed += 1;
    const outcome = await extractClaimed(item, deps);
    outcomes.push(outcome);
    if (outcome.status === "extracted") extracted += 1;
    else if (outcome.status === "failed") failed += 1;
  }

  return {
    requeued: requeued.length,
    claimed,
    extracted,
    failed,
    queued: countItemsWithStatus(deps.db, "queued"),
    outcomes,
  };
}
