/**
 * The review transition table: which review actions may start from which
 * item status, and the status each leaves behind.
 *
 * The table is keyed by action rather than by (from, to) pair, because a pair
 * table cannot tell `edit` (needs_review to itself) from a no-op, and callers
 * hold an action, not a target.
 *
 * `queued` and `extracting` are neither sources nor targets. Extraction owns
 * those transitions and never consults this table, so review can never push an
 * item back into the pipeline.
 *
 * There is no role parameter. `reopen` is "admin-only" in the design, but every
 * session carries the shared admin actor, so the admin gate is the
 * authorization.
 *
 * CONCURRENCY: this table is a pre-check, not the concurrency guard.
 * `reviewItem` reads the item, calls `targetStatus`, then performs its UPDATE
 * with `WHERE id = ? AND status = ?` (the status it read) and treats zero
 * changed rows as a lost race. The table cannot make that update safe; it only
 * gives the caller the target status and a clean 409 before any write. Do not
 * treat a successful `targetStatus` call as a lock.
 */
import type { ItemStatus } from "@/db/types";

export type ReviewAction = "accept" | "edit" | "reject" | "reopen";

export interface Transition {
  /** Statuses this action may start from. */
  readonly from: readonly ItemStatus[];
  /** Status the item holds afterwards. */
  readonly to: ItemStatus;
}

export const TRANSITIONS: Readonly<Record<ReviewAction, Transition>> = {
  accept: { from: ["needs_review"], to: "published" },
  // Edit keeps the status; the caller still writes an audit event.
  // Not allowed from `published`: the requirements never ask for
  // post-publication edits, and what such an edit would do to `reviewed_by` and
  // `published_at` is unspecified, so it stays out rather than being invented.
  edit: { from: ["needs_review"], to: "needs_review" },
  // Rejecting a published item removes it from the public archive
  // (Requirements 4.4 and 6.3).
  reject: { from: ["needs_review", "published"], to: "rejected" },
  // A rejected item cannot be accepted directly; it is reopened first.
  reopen: { from: ["rejected"], to: "needs_review" },
};

export class InvalidTransition extends Error {
  readonly code = "INVALID_TRANSITION";
  /** The HTTP status a route maps this to. */
  readonly status = 409;
  readonly action: ReviewAction;
  readonly from: ItemStatus;

  constructor(action: ReviewAction, from: ItemStatus) {
    super(`Cannot ${action} an item in ${from}.`);
    this.name = "InvalidTransition";
    this.action = action;
    this.from = from;
  }
}

/** The status `action` moves `from` to, or throws InvalidTransition. */
export function targetStatus(action: ReviewAction, from: ItemStatus): ItemStatus {
  const transition = TRANSITIONS[action];
  if (!transition.from.includes(from)) throw new InvalidTransition(action, from);
  return transition.to;
}
