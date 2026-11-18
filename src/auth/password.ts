import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time password comparison. Both sides are hashed to 32-byte SHA-256 digests first:
 * `timingSafeEqual` throws on a length mismatch, so comparing the raw strings would turn a
 * wrong password into a 500 and leak the expected length.
 */
export function passwordMatches(given: string, expected: string): boolean {
  if (given === "" || expected === "") return false;
  return timingSafeEqual(digest(given), digest(expected));
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
