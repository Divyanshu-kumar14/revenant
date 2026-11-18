import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { displayName, nameKey } from "@/normalize/names";

describe("displayName", () => {
  it("leaves diacritics and non-Latin scripts exactly as written", () => {
    expect(displayName("Müller")).toBe("Müller");
    expect(displayName("李 小龙")).toBe("李 小龙");
  });

  it("trims and collapses internal whitespace", () => {
    expect(displayName("  J.  Smith ")).toBe("J. Smith");
    expect(displayName("John\t\n Smith")).toBe("John Smith");
  });

  it("keeps punctuation inside the name", () => {
    expect(displayName("St. Mary's")).toBe("St. Mary's");
    expect(displayName("J. H. van 't Hoff")).toBe("J. H. van 't Hoff");
  });

  it("strips wrapping quotes and brackets, and a trailing comma or full stop", () => {
    expect(displayName('"John Smith"')).toBe("John Smith");
    expect(displayName("“Müller”")).toBe("Müller");
    expect(displayName("(J. Smith)")).toBe("J. Smith");
    expect(displayName("[Mary Jones]")).toBe("Mary Jones");
    expect(displayName("Smith, John.")).toBe("Smith, John");
    expect(displayName("Smith,")).toBe("Smith");
    expect(displayName('("Smith").')).toBe("Smith");
  });

  it("does not strip a lone leading apostrophe that is part of the name", () => {
    expect(displayName("'t Hooft")).toBe("'t Hooft");
  });

  it("keeps typographic variants in their own display form", () => {
    expect(displayName("O’Brien")).toBe("O’Brien");
    expect(displayName("O'Brien")).toBe("O'Brien");
  });

  it("returns an empty string for empty and whitespace-only input", () => {
    expect(displayName("")).toBe("");
    expect(displayName("   \t\n ")).toBe("");
  });
});

describe("nameKey", () => {
  it("does not merge an initial with a full name", () => {
    expect(nameKey("J. Smith")).not.toBe(nameKey("John Smith"));
  });

  it("lowercases and normalises spacing around commas", () => {
    expect(nameKey("Smith, John")).toBe("smith, john");
    expect(nameKey("Smith ,John")).toBe("smith, john");
    expect(nameKey("Smith  ,   John")).toBe("smith, john");
  });

  it("folds typographic apostrophes so O’Brien and O'Brien share a key", () => {
    expect(nameKey("O’Brien")).toBe("o'brien");
    expect(nameKey("O'Brien")).toBe("o'brien");
    expect(nameKey("Oʼbrien")).toBe("o'brien");
  });

  it("folds dash variants so Smith—Jones and Smith-Jones share a key", () => {
    expect(nameKey("Smith—Jones")).toBe(nameKey("Smith-Jones"));
    expect(nameKey("Smith‐Jones")).toBe("smith-jones");
  });

  it("keeps diacritics and internal punctuation", () => {
    expect(nameKey("Müller")).toBe("müller");
    expect(nameKey("St. Mary's")).toBe("st. mary's");
  });

  it("lowercases I without a locale, so it never becomes a dotless ı", () => {
    expect(nameKey("IZMIR")).toBe("izmir");
  });

  it("returns an empty string for empty and whitespace-only input", () => {
    expect(nameKey("")).toBe("");
    expect(nameKey("  ")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Properties

const pieces = fc.constantFrom(
  "a", "Z", "ü", "Ö", "é", "ß", "ẞ", "İ", "ı", "Σ", "ς", "李", "小龙", "ﬁ", "Ａ", "½",
  "\u0301", "\u0308", "\u0327", " ", "  ", "\t", "\u00a0", "\u3000",
  ".", ",", " , ", "'", "’", "‘", "ʼ", "ʹ", "-", "‐", "—", "―",
  '"', "“", "”", "«", "»", "(", ")", "[", "]", "{", "}",
);
const nameish = fc.array(pieces, { maxLength: 12 }).map((parts) => parts.join(""));
const anyName = fc.oneof(nameish, fc.string({ unit: "grapheme" }), fc.string({ unit: "binary" }));

/** Count of each combining mark (Unicode category M) in the canonical decomposition. */
function marks(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text.normalize("NFD")) {
    if (/\p{M}/u.test(char)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
}

const FOLDED = /[\u2018\u2019\u02bc\u02b9\u2010-\u2015]/;

describe("name properties", () => {
  it("displayName and nameKey are idempotent", () => {
    fc.assert(
      fc.property(anyName, (x) => {
        expect(displayName(displayName(x))).toBe(displayName(x));
        expect(nameKey(nameKey(x))).toBe(nameKey(x));
      }),
      { numRuns: 3000 },
    );
  });

  it("nameKey(displayName(x)) === nameKey(x)", () => {
    fc.assert(
      fc.property(anyName, (x) => {
        expect(nameKey(displayName(x))).toBe(nameKey(x));
      }),
      { numRuns: 3000 },
    );
  });

  it("is case-blind for letters with diacritics", () => {
    expect(nameKey("MÜLLER")).toBe(nameKey("müller"));
  });

  it("keeps every combining mark from the display form in the key", () => {
    fc.assert(
      fc.property(anyName, (x) => {
        fc.pre(!FOLDED.test(x));
        const shown = marks(displayName(x));
        const kept = marks(nameKey(x));
        for (const [mark, count] of shown) {
          expect(kept.get(mark) ?? 0).toBeGreaterThanOrEqual(count);
        }
      }),
      { numRuns: 3000 },
    );
  });
});
