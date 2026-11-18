import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PRECISIONS } from "@/extract/provider";
import { normalizeDate, type NormalizedDate } from "@/normalize/date";

// Fixed clock: the upper year bound is currentYear + 1 = 2027.
const NOW = new Date("2026-11-18T12:00:00Z");
const MAX_YEAR = 2027;
const norm = (input: string | null | undefined, structured?: Parameters<typeof normalizeDate>[1]) =>
  normalizeDate(input, structured, NOW);

const unknown = (display: string | null): NormalizedDate => ({
  display,
  start: null,
  end: null,
  precision: "unknown",
  ambiguous: false,
});

describe("normalizeDate: the archive conventions §1 table", () => {
  it.each([
    // [row, inputs, start, end, precision, display]
    ["full date", ["December 25, 1938", "25 December 1938", "1938-12-25"], "1938-12-25", "1938-12-25", "day", "December 25, 1938"],
    ["month + year", ["March 1938", "Mar. 1938"], "1938-03-01", "1938-03-31", "month", "March 1938"],
    ["year", ["1938"], "1938-01-01", "1938-12-31", "year", "1938"],
    ["decade", ["1930s", "1930's"], "1930-01-01", "1939-12-31", "decade", "1930s"],
    ["circa", ["c. 1900", "ca. 1900", "circa 1900", "about 1900", "1900?"], "1895-01-01", "1905-12-31", "circa", "ca. 1900"],
    ["season", ["Summer 1938"], "1938-06-01", "1938-08-31", "season", "Summer 1938"],
    ["range", ["1935–1939", "1935-39", "between 1935 and 1939"], "1935-01-01", "1939-12-31", "range", "1935–1939"],
    ["open past", ["before 1940"], "1800-01-01", "1939-12-31", "before", "before 1940"],
    ["open future", ["after 1940"], "1941-01-01", `${MAX_YEAR}-12-31`, "after", "after 1940"],
  ] as const)("%s", (_row, inputs, start, end, precision, display) => {
    for (const input of inputs) {
      expect(norm(input), input).toEqual({ display, start, end, precision, ambiguous: false });
    }
  });

  it("runs winter into February of the following year, including a leap day", () => {
    expect(norm("Winter 1939")).toMatchObject({ start: "1939-12-01", end: "1940-02-29", display: "Winter 1939" });
    expect(norm("Winter 1938")).toMatchObject({ start: "1938-12-01", end: "1939-02-28" });
  });
});

describe("normalizeDate: structured dates win (ADR 0001 gate cases)", () => {
  it.each([
    ["3-2-10", "1910-03-02", "March 2, 1910"],
    ["3-1-10", "1910-03-01", "March 1, 1910"],
  ])("%s with structured start %s is %s, ambiguous, never 2010", (text, start, display) => {
    expect(norm(text, { start, precision: "day" })).toEqual({
      display,
      start,
      end: start,
      precision: "day",
      ambiguous: true,
    });
  });

  it("is not ambiguous when the display text agrees with the structured date", () => {
    expect(norm("1912", { start: "1912-01-01", end: "1912-12-31", precision: "year" }).ambiguous).toBe(false);
    expect(norm("March 1938", { start: "1938-03-04", end: "1938-03-04", precision: "day" }).ambiguous).toBe(false);
  });

  it("falls back to the display text when the structured fields are invalid or absent", () => {
    for (const structured of [
      { start: "1910-02-30", precision: "day" as const },
      { start: "1750-01-01", end: "1750-12-31", precision: "year" as const },
      { start: "1939-01-01", end: "1935-12-31", precision: "range" as const },
      { start: "1912-03-05", end: "1912-12-31", precision: "year" as const },
      { start: "1912-01-01", end: "1912-12-31", precision: "unknown" as const },
      {},
    ]) {
      expect(norm("1938", structured), JSON.stringify(structured)).toMatchObject({ precision: "year", start: "1938-01-01" });
    }
  });
});

describe("normalizeDate: numeric dates and two-digit years", () => {
  it("reads 25/12/1938 as a day because the first component exceeds 12", () => {
    expect(norm("25/12/1938")).toEqual({
      display: "December 25, 1938",
      start: "1938-12-25",
      end: "1938-12-25",
      precision: "day",
      ambiguous: false,
    });
  });

  it("flags 03/04/1938 as ambiguous instead of silently picking", () => {
    expect(norm("03/04/1938")).toMatchObject({ start: "1938-03-04", precision: "day", ambiguous: true });
  });

  it("pivots two-digit years at 30 and always flags them", () => {
    expect(norm("5/6/31")).toMatchObject({ start: "1931-05-06", ambiguous: true });
    expect(norm("1/2/25")).toMatchObject({ start: "2025-01-02", ambiguous: true });
    expect(norm("12/25/45")).toMatchObject({ start: "1945-12-25", ambiguous: true });
  });
});

describe("normalizeDate: unknown", () => {
  it.each(["1750", "2999", "before 1800", "after 2027", "c. 1798"])("%s is out of bounds", (input) => {
    expect(norm(input)).toEqual(unknown(input));
  });

  it.each(["1939–1935", "between 1939 and 1935", "1935-32"])("inverted range %s", (input) => {
    expect(norm(input)).toEqual(unknown(input));
  });

  it("returns display null for null, undefined, empty and blank input", () => {
    for (const input of [null, undefined, "", "   "]) expect(norm(input)).toEqual(unknown(null));
  });

  it("keeps the trimmed original and never substitutes today", () => {
    expect(norm("  the summer the barn burned  ")).toEqual(unknown("the summer the barn burned"));
    expect(norm("2/30/1938")).toEqual(unknown("2/30/1938"));
  });
});

// ---------------------------------------------------------------------------
// Properties

const year = fc.integer({ min: 1700, max: 2100 });
const twoDigits = fc.integer({ min: 0, max: 99 }).map((n) => String(n).padStart(2, "0"));
const monthName = fc.constantFrom("January", "Mar.", "sept", "DEC.", "May", "Jun");
const season = fc.constantFrom("Spring", "summer", "Autumn", "fall", "WINTER");
const shaped = fc.oneof(
  year.map(String),
  fc.tuple(monthName, fc.integer({ min: 1, max: 31 }), year).map(([m, d, y]) => `${m} ${d}, ${y}`),
  fc.tuple(fc.integer({ min: 1, max: 31 }), monthName, year).map(([d, m, y]) => `${d} ${m} ${y}`),
  fc.tuple(monthName, year).map(([m, y]) => `${m} ${y}`),
  fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 40 }), fc.oneof(year.map(String), twoDigits)).map(
    ([a, b, y]) => `${a}/${b}/${y}`,
  ),
  fc.tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 31 }), twoDigits).map(([a, b, y]) => `${a}-${b}-${y}`),
  fc.integer({ min: 170, max: 210 }).map((d) => `${d}0s`),
  fc.tuple(fc.constantFrom("c. ", "ca. ", "circa ", "about ", ""), year, fc.constantFrom("", "?")).map(
    ([p, y, q]) => `${p}${y}${q}`,
  ),
  fc.tuple(season, year).map(([s, y]) => `${s} ${y}`),
  fc.tuple(year, fc.oneof(year.map(String), twoDigits), fc.constantFrom("–", "-", " – ")).map(([a, b, sep]) => `${a}${sep}${b}`),
  fc.tuple(year, year).map(([a, b]) => `between ${a} and ${b}`),
  fc.tuple(fc.constantFrom("before ", "after "), year).map(([p, y]) => `${p}${y}`),
);
const anyText = fc.oneof(shaped, fc.string(), fc.constant(null));

const isoLike = fc.oneof(
  fc.tuple(year, fc.integer({ min: 0, max: 13 }), fc.integer({ min: 0, max: 32 })).map(
    ([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  ),
  fc.string(),
  fc.constant(null),
);
const structured = fc.option(
  fc.record(
    { start: isoLike, end: isoLike, precision: fc.constantFrom(...PRECISIONS) },
    { requiredKeys: [] },
  ),
  { nil: undefined },
);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

describe("normalizeDate properties", () => {
  it("is idempotent on display and bounds", () => {
    fc.assert(
      fc.property(anyText, structured, (text, given) => {
        const first = norm(text, given);
        const second = norm(first.display);
        expect(second.display).toBe(first.display);
        expect([second.start, second.end, second.precision]).toEqual([first.start, first.end, first.precision]);
      }),
      { numRuns: 2000 },
    );
  });

  it("keeps start <= end, valid ISO dates, and every year inside 1800..currentYear + 1", () => {
    fc.assert(
      fc.property(anyText, structured, (text, given) => {
        const { start, end, precision } = norm(text, given);
        expect(start === null).toBe(end === null);
        expect(start === null).toBe(precision === "unknown");
        for (const date of [start, end]) {
          if (date === null) continue;
          expect(date).toMatch(ISO);
          const y = Number(date.slice(0, 4));
          expect(y).toBeGreaterThanOrEqual(1800);
          expect(y).toBeLessThanOrEqual(MAX_YEAR);
        }
        if (start !== null && end !== null) expect(start <= end).toBe(true);
      }),
      { numRuns: 2000 },
    );
  });

  it("lets any valid span, given as structured fields, win over any display text", () => {
    fc.assert(
      fc.property(shaped, anyText, (source, text) => {
        const span = norm(source);
        fc.pre(span.precision !== "unknown");
        const result = norm(text, { start: span.start, end: span.end, precision: span.precision });
        expect([result.display, result.start, result.end, result.precision]).toEqual([
          span.display,
          span.start,
          span.end,
          span.precision,
        ]);
      }),
      { numRuns: 2000 },
    );
  });

  it("never gives a year-only input a month or day", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 9999 }), (n) => {
        const y = String(n).padStart(4, "0");
        const result = norm(y);
        if (result.precision === "unknown") {
          expect(result.start).toBeNull();
        } else {
          expect(result).toEqual({ display: y, start: `${y}-01-01`, end: `${y}-12-31`, precision: "year", ambiguous: false });
        }
      }),
    );
  });
});
