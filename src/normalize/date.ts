import type { Precision } from "../extract/provider.ts";

/**
 * Date normalisation per .kiro/steering/archive-conventions.md §1.
 * Pure: no I/O, no clock other than the injected `now`, which only sets the upper bound.
 */
export interface NormalizedDate {
  display: string | null;
  start: string | null;
  end: string | null;
  precision: Precision;
  ambiguous: boolean;
}

export interface StructuredDate {
  start?: string | null;
  end?: string | null;
  precision?: Precision;
}

const MIN_YEAR = 1800;
/** Circa is a window of ±5 years (§1 rule 5). */
const CIRCA_SPAN = 5;
/** Two-digit years 00–30 are 2000–2030, 31–99 are 1931–1999 (§1 rule 6). */
const PIVOT = 30;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTHS = new Map<string, number>([
  ...MONTH_NAMES.map((name, i): [string, number] => [name.toLowerCase(), i + 1]),
  ...["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].map(
    (abbr, i): [string, number] => [abbr, i + 1],
  ),
  ["sept", 9],
]);

function monthNumber(name: string): number {
  return MONTHS.get(name) ?? 0;
}

type Season = "spring" | "summer" | "autumn" | "winter";
/** Northern-hemisphere calendar seasons (§1 rule 4): first month of each; winter runs into the next year. */
const SEASON_START: Record<Season, number> = { spring: 3, summer: 6, autumn: 9, winter: 12 };
const SEASON_NAMES: Record<Season, string> = { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" };

/** Inclusive year bounds. Archive bounds for results; unbounded only to read a display text for comparison. */
interface Limits {
  min: number;
  max: number;
}
const UNBOUNDED: Limits = { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY };

interface Span {
  start: string;
  end: string;
  precision: Exclude<Precision, "unknown">;
  ambiguous: boolean;
}

/**
 * Normalise a date. When `structured` carries a valid, in-bounds, ordered span with a §1 display
 * form, it wins and `input` only decides `ambiguous`. Otherwise `input` is parsed per §1.
 * Anything that cannot be parsed honestly is `unknown` with null bounds and the trimmed original.
 */
export function normalizeDate(
  input: string | null | undefined,
  structured?: StructuredDate,
  now: Date = new Date(),
): NormalizedDate {
  const limits: Limits = { min: MIN_YEAR, max: now.getUTCFullYear() + 1 };
  const text = typeof input === "string" ? input.trim() : "";

  const fromStructured = structured ? structuredSpan(structured, limits) : null;
  if (fromStructured) {
    // §1 rule 6: the structured date wins. The text is read without bounds, so a reading that
    // lands out of bounds (e.g. "3-2-29" as 2029) still counts as disagreeing.
    const reading = text ? parseText(text, UNBOUNDED) : null;
    const disagrees = reading !== null && !(reading.start <= fromStructured.start && fromStructured.end <= reading.end);
    return { ...render(fromStructured), ambiguous: disagrees };
  }
  const parsed = text ? parseText(text, limits) : null;
  if (parsed) return { ...render(parsed), ambiguous: parsed.ambiguous };
  // §1 rule 1: never substitute today, the ingest date or a file time.
  return { display: text || null, start: null, end: null, precision: "unknown", ambiguous: false };
}

// ---------------------------------------------------------------------------
// Text

function parseText(raw: string, limits: Limits): Span | null {
  const s = raw
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2013\u2014]/g, "–")
    .replace(/\s+/g, " ");
  let m: RegExpMatchArray | null;

  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    return day(Number(m[1]), Number(m[2]), Number(m[3]), false, limits);
  }
  if ((m = s.match(/^(\d{1,2})([/.-])(\d{1,2})\2(\d{2}|\d{4})$/))) {
    return numeric(Number(m[1]), Number(m[3]), m[4], limits);
  }
  // Month-name branches fall through when the word is not a month ("before 1940", "about 1900").
  if ((m = s.match(/^([a-z]+)\.? (\d{1,2}),? (\d{4})$/)) && MONTHS.has(m[1])) {
    return day(Number(m[3]), monthNumber(m[1]), Number(m[2]), false, limits);
  }
  if ((m = s.match(/^(\d{1,2}) ([a-z]+)\.?,? (\d{4})$/)) && MONTHS.has(m[2])) {
    return day(Number(m[3]), monthNumber(m[2]), Number(m[1]), false, limits);
  }
  if ((m = s.match(/^(spring|summer|autumn|fall|winter) (\d{4})$/))) {
    return season(m[1] === "fall" ? "autumn" : (m[1] as Season), Number(m[2]), limits);
  }
  if ((m = s.match(/^([a-z]+)\.?,? (\d{4})$/)) && MONTHS.has(m[1])) {
    return monthSpan(Number(m[2]), monthNumber(m[1]), limits);
  }
  if ((m = s.match(/^(\d{3}0)'?s$/))) {
    const year = Number(m[1]);
    return bounded({ start: iso(year, 1, 1), end: iso(year + 9, 12, 31), precision: "decade", ambiguous: false }, limits);
  }
  if ((m = s.match(/^(?:c\.?|ca\.?|circa|about) ?(\d{4})$/)) || (m = s.match(/^(\d{4}) ?\?$/))) {
    const year = Number(m[1]);
    return bounded(
      { start: iso(year - CIRCA_SPAN, 1, 1), end: iso(year + CIRCA_SPAN, 12, 31), precision: "circa", ambiguous: false },
      limits,
    );
  }
  if ((m = s.match(/^(\d{4}) ?[-–] ?(\d{2}|\d{4})$/))) {
    const first = Number(m[1]);
    // "1935-39": a two-digit end year keeps the start year's century.
    const last = m[2].length === 2 ? Math.floor(first / 100) * 100 + Number(m[2]) : Number(m[2]);
    return range(first, last, limits);
  }
  if ((m = s.match(/^between (\d{4}) and (\d{4})$/))) {
    return range(Number(m[1]), Number(m[2]), limits);
  }
  if ((m = s.match(/^before (\d{4})$/))) {
    const year = Number(m[1]);
    return bounded({ start: iso(MIN_YEAR, 1, 1), end: iso(year - 1, 12, 31), precision: "before", ambiguous: false }, limits);
  }
  if ((m = s.match(/^after (\d{4})$/))) {
    const year = Number(m[1]);
    return bounded({ start: iso(year + 1, 1, 1), end: iso(limits.max, 12, 31), precision: "after", ambiguous: false }, limits);
  }
  if ((m = s.match(/^(\d{4})$/))) {
    // §1 rule 8: a year alone never gains a month or day.
    const year = Number(m[1]);
    return bounded({ start: iso(year, 1, 1), end: iso(year, 12, 31), precision: "year", ambiguous: false }, limits);
  }
  return null;
}

/** §1 rule 7: a first component over 12 is a day; otherwise US month-first, flagged when both could be months. */
function numeric(first: number, second: number, yearText: string, limits: Limits): Span | null {
  const twoDigit = yearText.length === 2;
  const year = twoDigit ? pivot(Number(yearText)) : Number(yearText);
  if (first > 12) return day(year, second, first, twoDigit, limits);
  return day(year, first, second, twoDigit || second <= 12, limits);
}

function pivot(twoDigit: number): number {
  return twoDigit <= PIVOT ? 2000 + twoDigit : 1900 + twoDigit;
}

function day(year: number, month: number, dayOfMonth: number, ambiguous: boolean, limits: Limits): Span | null {
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > daysInMonth(year, month)) return null;
  const date = iso(year, month, dayOfMonth);
  return bounded({ start: date, end: date, precision: "day", ambiguous }, limits);
}

function monthSpan(year: number, month: number, limits: Limits): Span | null {
  return bounded(
    { start: iso(year, month, 1), end: iso(year, month, daysInMonth(year, month)), precision: "month", ambiguous: false },
    limits,
  );
}

function season(name: Season, year: number, limits: Limits): Span | null {
  const first = SEASON_START[name];
  const lastYear = name === "winter" ? year + 1 : year;
  const lastMonth = name === "winter" ? 2 : first + 2;
  return bounded(
    {
      start: iso(year, first, 1),
      end: iso(lastYear, lastMonth, daysInMonth(lastYear, lastMonth)),
      precision: "season",
      ambiguous: false,
    },
    limits,
  );
}

function range(first: number, last: number, limits: Limits): Span | null {
  return bounded({ start: iso(first, 1, 1), end: iso(last, 12, 31), precision: "range", ambiguous: false }, limits);
}

// ---------------------------------------------------------------------------
// Structured

/**
 * A structured span is used only when it is valid ISO, in bounds, ordered, and has a §1 display
 * form that matches its precision. Missing bounds are filled only where §1 fixes them.
 */
function structuredSpan(input: StructuredDate, limits: Limits): Span | null {
  const precision = input.precision;
  if (precision === "unknown") return null;
  const given = (value: string | null | undefined) => value !== undefined && value !== null;
  if (given(input.start) && !isIsoDate(input.start)) return null;
  if (given(input.end) && !isIsoDate(input.end)) return null;
  let start = input.start ?? null;
  let end = input.end ?? null;

  if (start && !end) end = impliedEnd(start, precision, limits);
  if (end && !start) start = impliedStart(end, precision);
  if (!start || !end) return null;

  const span = bounded({ start, end, precision: "day", ambiguous: false }, limits);
  if (!span) return null;
  const shape = precision ?? inferPrecision(start, end);
  if (!shape || !fits(start, end, shape, limits)) return null;
  return { start, end, precision: shape, ambiguous: false };
}

function impliedEnd(start: string, precision: Precision | undefined, limits: Limits): string | null {
  const { year, month, dayOfMonth } = parts(start);
  switch (precision) {
    case "day":
      return start;
    case "month":
      return dayOfMonth === 1 ? iso(year, month, daysInMonth(year, month)) : null;
    case "year":
      return month === 1 && dayOfMonth === 1 ? iso(year, 12, 31) : null;
    case "decade":
      return month === 1 && dayOfMonth === 1 && year % 10 === 0 ? iso(year + 9, 12, 31) : null;
    case "season": {
      const name = seasonStarting(month, dayOfMonth);
      return name ? (season(name, year, UNBOUNDED)?.end ?? null) : null;
    }
    case "after":
      return iso(limits.max, 12, 31);
    default:
      return null;
  }
}

function impliedStart(end: string, precision: Precision | undefined): string | null {
  if (precision === "before") return iso(MIN_YEAR, 1, 1);
  if (precision === "day") return end;
  return null;
}

/** The natural §1 shape of a span when no precision was supplied. Decade, circa, before and after need one. */
function inferPrecision(start: string, end: string): Span["precision"] | null {
  for (const shape of ["day", "month", "season", "year", "range"] as const) {
    if (fits(start, end, shape, UNBOUNDED)) return shape;
  }
  return null;
}

function fits(start: string, end: string, precision: Span["precision"], limits: Limits): boolean {
  const a = parts(start);
  const b = parts(end);
  const yearAligned = a.month === 1 && a.dayOfMonth === 1 && b.month === 12 && b.dayOfMonth === 31;
  switch (precision) {
    case "day":
      return start === end;
    case "month":
      return a.year === b.year && a.month === b.month && a.dayOfMonth === 1 && b.dayOfMonth === daysInMonth(b.year, b.month);
    case "season": {
      const name = seasonStarting(a.month, a.dayOfMonth);
      return name !== null && season(name, a.year, UNBOUNDED)?.end === end;
    }
    case "year":
      return yearAligned && a.year === b.year;
    case "decade":
      return yearAligned && a.year % 10 === 0 && b.year === a.year + 9;
    case "circa":
      return yearAligned && b.year === a.year + 2 * CIRCA_SPAN;
    case "range":
      return yearAligned && a.year <= b.year;
    case "before":
      return start === iso(MIN_YEAR, 1, 1) && b.month === 12 && b.dayOfMonth === 31;
    case "after":
      return a.month === 1 && a.dayOfMonth === 1 && end === iso(limits.max, 12, 31);
  }
}

function seasonStarting(month: number, dayOfMonth: number): Season | null {
  if (dayOfMonth !== 1) return null;
  const entry = (Object.entries(SEASON_START) as [Season, number][]).find(([, first]) => first === month);
  return entry ? entry[0] : null;
}

/** Season of a validated season span's first month (3, 6, 9 or 12). */
function seasonOfMonth(month: number): Season {
  if (month === 3) return "spring";
  if (month === 6) return "summer";
  if (month === 9) return "autumn";
  return "winter";
}

// ---------------------------------------------------------------------------
// Display (§1 rule 9)

function render(span: Span): Omit<NormalizedDate, "ambiguous"> {
  const a = parts(span.start);
  const b = parts(span.end);
  const display = (() => {
    switch (span.precision) {
      case "day":
        return `${MONTH_NAMES[a.month - 1]} ${a.dayOfMonth}, ${a.year}`;
      case "month":
        return `${MONTH_NAMES[a.month - 1]} ${a.year}`;
      case "year":
        return String(a.year);
      case "decade":
        return `${a.year}s`;
      case "circa":
        return `ca. ${a.year + CIRCA_SPAN}`;
      case "season":
        return `${SEASON_NAMES[seasonOfMonth(a.month)]} ${a.year}`;
      case "range":
        return `${a.year}–${b.year}`;
      case "before":
        return `before ${b.year + 1}`;
      case "after":
        return `after ${a.year - 1}`;
    }
  })();
  return { display, start: span.start, end: span.end, precision: span.precision };
}

// ---------------------------------------------------------------------------
// Calendar helpers

/** §1 rules 2 and 3: every year within 1800..currentYear + 1, and start <= end. */
function bounded(span: Span, limits: Limits): Span | null {
  const first = parts(span.start).year;
  const last = parts(span.end).year;
  if (!Number.isInteger(first) || !Number.isInteger(last)) return null;
  if (first < limits.min || last < limits.min || first > limits.max || last > limits.max) return null;
  if (span.start > span.end) return null;
  return span;
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const month = Number(m[2]);
  const dayOfMonth = Number(m[3]);
  return month >= 1 && month <= 12 && dayOfMonth >= 1 && dayOfMonth <= daysInMonth(Number(m[1]), month);
}

function parts(date: string): { year: number; month: number; dayOfMonth: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), dayOfMonth: Number(date.slice(8, 10)) };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year: number, month: number, dayOfMonth: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`;
}
