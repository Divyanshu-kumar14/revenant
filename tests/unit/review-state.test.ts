import { describe, expect, it } from "vitest";
import type { ItemStatus } from "@/db/types";
import { InvalidTransition, TRANSITIONS, targetStatus, type ReviewAction } from "@/review/state";

// Keyed objects, so a sixth status or a fifth action fails typecheck here
// until the matrix covers it.
const STATUS_KEYS = {
  queued: true,
  extracting: true,
  needs_review: true,
  published: true,
  rejected: true,
} satisfies Record<ItemStatus, true>;
const ACTION_KEYS = { accept: true, edit: true, reject: true, reopen: true } satisfies Record<ReviewAction, true>;

const STATUSES = Object.keys(STATUS_KEYS) as ItemStatus[];
const ACTIONS = Object.keys(ACTION_KEYS) as ReviewAction[];

/** The spec's allowed pairs, as `action from -> to`. */
const ALLOWED: ReadonlyArray<readonly [ReviewAction, ItemStatus, ItemStatus]> = [
  ["accept", "needs_review", "published"],
  ["edit", "needs_review", "needs_review"],
  ["reject", "needs_review", "rejected"],
  ["reject", "published", "rejected"],
  ["reopen", "rejected", "needs_review"],
];

function isAllowed(action: ReviewAction, from: ItemStatus): boolean {
  return ALLOWED.some(([a, f]) => a === action && f === from);
}

const MATRIX = ACTIONS.flatMap((action) => STATUSES.map((from) => [action, from] as const));
const REJECTED = MATRIX.filter(([action, from]) => !isAllowed(action, from));

function rejection(action: ReviewAction, from: ItemStatus): unknown {
  try {
    targetStatus(action, from);
  } catch (error) {
    return error;
  }
  throw new Error(`expected ${action} from ${from} to throw`);
}

describe("review transition table", () => {
  it("covers all 20 action and status combinations, 15 of them rejected", () => {
    expect(MATRIX).toHaveLength(20);
    expect(REJECTED).toHaveLength(15);
  });

  it.each(ALLOWED)("%s from %s moves to %s", (action, from, to) => {
    expect(targetStatus(action, from)).toBe(to);
  });

  it("allows exactly the five pairs in the spec", () => {
    const fromTable = Object.entries(TRANSITIONS)
      .flatMap(([action, t]) => t.from.map((from) => `${action} ${from} -> ${t.to}`))
      .sort();
    const fromSpec = ALLOWED.map(([action, from, to]) => `${action} ${from} -> ${to}`).sort();
    expect(fromTable).toEqual(fromSpec);
  });

  it("never targets queued or extracting", () => {
    for (const transition of Object.values(TRANSITIONS)) {
      expect(["queued", "extracting"]).not.toContain(transition.to);
    }
  });
});

describe("InvalidTransition", () => {
  it("is thrown for every rejected pair", () => {
    for (const [action, from] of REJECTED) {
      expect(rejection(action, from), `${action} from ${from}`).toBeInstanceOf(InvalidTransition);
    }
  });

  it("maps to HTTP 409 for every rejected pair", () => {
    for (const [action, from] of REJECTED) {
      expect((rejection(action, from) as InvalidTransition).status, `${action} from ${from}`).toBe(409);
    }
  });

  it("carries code INVALID_TRANSITION for every rejected pair", () => {
    for (const [action, from] of REJECTED) {
      expect((rejection(action, from) as InvalidTransition).code, `${action} from ${from}`).toBe("INVALID_TRANSITION");
    }
  });

  it("reports the action and from status it was given", () => {
    for (const [action, from] of REJECTED) {
      const error = rejection(action, from) as InvalidTransition;
      expect({ action: error.action, from: error.from }).toEqual({ action, from });
    }
  });

  it("states the refused action and status as one sentence", () => {
    expect((rejection("accept", "queued") as InvalidTransition).message).toBe("Cannot accept an item in queued.");
  });
});
