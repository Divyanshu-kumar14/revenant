/**
 * The prompt is versioned because every published record cites the prompt that
 * produced it. Bump PROMPT_VERSION on any change that could alter output; never
 * edit a version in place.
 *
 * Rules mirror .kiro/steering/archive-conventions.md. When they disagree, the
 * steering file wins and this prompt is wrong.
 */
export const PROMPT_VERSION = "v1";

export const EXTRACTION_PROMPT = `You are reading a scanned historical photograph for a small volunteer archive. Return exactly one JSON object and nothing else. No prose, no markdown fences.

Rules:
- Transcribe only writing visible in the image. Preserve spelling, capitalisation and line breaks. Write [illegible] where a word cannot be read. If there is no writing at all, transcription is null.
- Never invent a name, date, place or subject. A field you cannot read is null or an empty array. An invented name is worse than a missing one.
- description: one or two sentences on what is visible. Do not identify people and do not assert a location the item does not support.
- title: a short neutral title. Do not add a proper name to make it read better.
- date: report what the item states. Do not infer a date from clothing, vehicles or photographic process.
  precision is one of: day, month, year, decade, season, circa, range, before, after, unknown.
  start and end are ISO YYYY-MM-DD bounds around the stated period, or null.
  A stated year alone is start=YYYY-01-01, end=YYYY-12-31, precision=year. Never narrow a year to a day.
  circa is a window of five years either side. Unknown means null, null, precision unknown.
- people and places: only names written on the item or present in the transcription, in the form written. Do not append a state or country the item does not state.
- subjects: one to five lowercase topical terms, plural where natural.
- confidence: your own certainty in [0,1] for each field. This is a self-report, not a probability of correctness.

JSON shape:
{
  "transcription": string | null,
  "title": string | null,
  "description": string | null,
  "date": {
    "display": string | null,
    "start": string | null,
    "end": string | null,
    "precision": "day" | "month" | "year" | "decade" | "season" | "circa" | "range" | "before" | "after" | "unknown"
  },
  "people": [{ "name": string, "confidence": number }],
  "places": [{ "name": string, "confidence": number }],
  "subjects": [{ "name": string, "confidence": number }],
  "confidence": { "transcription": number, "title": number, "description": number, "date": number, "people": number, "places": number, "subjects": number }
}`;
