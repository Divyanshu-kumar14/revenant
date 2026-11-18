/**
 * Name normalisation per .kiro/steering/archive-conventions.md §2.
 * `displayName` is what a person reads; `nameKey` is what the database matches on.
 * Pure, no locale, no collation: names are normalised here and compared elsewhere.
 */

/**
 * Quote characters that may wrap a name. Every character `nameKey` folds to an apostrophe is
 * included, so folding can never create a wrapping pair that `displayName` would then strip.
 */
const QUOTES = new Set(["\"", "'", "\u2018", "\u2019", "\u201a", "\u201b", "\u201c", "\u201d", "\u201e", "\u201f", "\u00ab", "\u00bb", "\u2039", "\u203a", "\u02bc", "\u02b9"]);
const BRACKETS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);
/** Typographic apostrophes folded to U+0027 in the key. */
const APOSTROPHES = /[\u2018\u2019\u02bc\u02b9]/g;
/** Hyphen and dash variants U+2010..U+2015 folded to U+002D in the key. */
const DASHES = /[\u2010-\u2015]/g;
/** Bounded so a pathological input cannot loop; real names settle in one or two passes. */
const MAX_PASSES = 32;

/**
 * NFKC, trim, collapse whitespace, strip wrapping quotes and brackets and a trailing comma or
 * full stop. Never strips punctuation inside the name, never removes accents, never transliterates.
 * Returns "" for empty or whitespace-only input; the caller treats that as absent.
 */
export function displayName(raw: string): string {
  let current = raw;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = unwrap(collapse(current.normalize("NFKC")));
    if (next === current) return next;
    current = next;
  }
  return current;
}

/**
 * The matching form: `displayName`, typographic apostrophes and dashes folded to ASCII,
 * lowercased without a locale, and whitespace around commas normalised to ", ".
 * Does not expand initials or nicknames, add honorifics, or merge different names.
 */
export function nameKey(raw: string): string {
  let current = displayName(raw);
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    // toLowerCase, never toLocaleLowerCase: a Turkish locale would turn I into dotless ı.
    const lowered = current.replace(APOSTROPHES, "'").replace(DASHES, "-").toLowerCase();
    const next = displayName(lowered.replace(/\s*,\s*/g, ", "));
    if (next === current) return next;
    current = next;
  }
  return current;
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Remove one layer of wrapping punctuation, or a trailing comma or full stop. */
function unwrap(text: string): string {
  if (text.length === 0) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if (text.length >= 2 && QUOTES.has(first) && QUOTES.has(last)) return text.slice(1, -1).trim();
  if (text.length >= 2 && BRACKETS.get(first) === last) return text.slice(1, -1).trim();
  if (last === "," || last === ".") return text.slice(0, -1).trim();
  return text;
}
