---
inclusion: auto
name: archive-conventions
description: Date normalisation, name authority, confidence semantics, Dublin Core mapping and citation format. Use when writing or reviewing normalisation, extraction, review, publication, search or export code, or when validating a proposed record.
---

# Archive Conventions

These rules are the contract between the extractor, the reviewer and the published record. Code and prompt must both obey them. When a rule is ambiguous, choose the option that preserves uncertainty.

## 1. Dates

Store `date_start` and `date_end` as ISO `YYYY-MM-DD` strings, `date_display` as the human string, `date_precision` as one of `day | month | year | decade | season | circa | range | before | after | unknown`.

### Accepted inputs

| Input shape | Example | Start | End | Precision |
|---|---|---|---|---|
| Full date | `December 25, 1938`, `25 December 1938`, `1938-12-25` | `1938-12-25` | `1938-12-25` | `day` |
| Month + year | `March 1938`, `Mar. 1938` | `1938-03-01` | `1938-03-31` | `month` |
| Year | `1938` | `1938-01-01` | `1938-12-31` | `year` |
| Decade | `1930s`, `1930's` | `1930-01-01` | `1939-12-31` | `decade` |
| Circa | `c. 1900`, `ca. 1900`, `circa 1900`, `about 1900`, `1900?` | `1895-01-01` | `1905-12-31` | `circa` |
| Season | `Summer 1938` | `1938-06-01` | `1938-08-31` | `season` |
| Range | `1935–1939`, `1935-39`, `between 1935 and 1939` | `1935-01-01` | `1939-12-31` | `range` |
| Open past | `before 1940` | `1800-01-01` | `1939-12-31` | `before` |
| Open future | `after 1940` | `1941-01-01` | `{currentYear + 1}-12-31` | `after` |

### Rules

1. Unknown or unparseable input yields `null` start and end, precision `unknown`, and `date_display` equal to the trimmed original. Never substitute today's date, the ingest date or the file's modification time.
2. Bounds: every non-null year must satisfy `1800 <= year <= currentYear + 1`. Out of bounds is unknown.
3. `date_start <= date_end` always. If a range would invert, it is unknown.
4. Seasons are northern-hemisphere calendar seasons: spring Mar 1–May 31, summer Jun 1–Aug 31, autumn Sep 1–Nov 30, winter Dec 1–Feb 28/29 of the following year.
5. Circa is a window of ±5 years around the stated year.
6. Two-digit years use a pivot of 30: `00`–`30` → 2000–2030, `31`–`99` → 1931–1999. Every two-digit year is marked `ambiguous: true` for the reviewer. When a structured date and display text arrive together, the structured date wins; if parsing the display text disagrees with it, mark the field ambiguous rather than choosing.
7. Numeric dates: if the first component is greater than 12 it must be a day (`25/12/1938` → 1938-12-25). Otherwise interpret as US `M/D/Y`. When both first and second components are `<= 12`, set `ambiguous: true`; do not silently pick a convention.
8. A year alone never gains a month or day. A month alone never gains a year.
9. `date_display` is normalised, not copied: exact day → `December 25, 1938`; month → `March 1938`; year → `1938`; decade → `1930s`; circa → `ca. 1900`; season → `Summer 1938`; range → `1935–1939` with an en dash; open → `before 1940` / `after 1940`.
10. `normalizeDate(normalizeDate(x).display).display === normalizeDate(x).display`. Idempotency is a tested property.
11. A date is evidence only when it is visible in the image, supplied in the caption, or present in the item's existing metadata. Never infer a date from clothing, technology, film stock, handwriting style or a subject's apparent age. `unknown` is the correct answer for an undated photograph.

## 2. Names

`display_name` is what a person reads; `name_key` is what the database matches on.

- `displayName`: Unicode NFKC, trim, collapse internal whitespace, strip a matched pair of quotation marks or brackets that wraps the whole name, preserve diacritics and non-Latin scripts. Keep internal punctuation, initials and abbreviations such as `J.` and `Jr.`; never strip a trailing full stop or comma. NFKC may fold ligatures and width variants (`ﬁ` → `fi`, `Ａ` → `A`), which is intended. Never strip accents; never transliterate. `Müller` stays `Müller`, `李 小龙` stays `李 小龙`. `İstanbul` and `Istanbul` intentionally produce different keys, because case mapping is locale-independent.
- `nameKey`: apply `displayName`, lowercase with a locale-independent lowercase, collapse whitespace around commas to `, `, keep diacritics. Idempotent.
- Identity: `(type, name_key)` is unique. Do not merge `J. Smith` with `John Smith`, do not expand nicknames, do not infer gender, do not add honorifics the source does not contain.
- Types are exactly `person`, `place`, `subject`.
- A name may be recorded only if it appears in the transcription, the supplied caption, or the item's existing metadata. The extractor must never invent a plausible name to fill a field.
- Places: store the name as written. Do not append a state or country the source does not state; geocoding resolves ambiguity separately.
- Subjects: one to five short topical terms, lowercase, plural where natural (`schools`, `floods`, `harvest`). No hierarchy, no invented specificity.

## 3. Confidence

- Every extracted field carries a model-reported confidence in `[0, 1]`. This is a self-report, not a calibrated probability; the UI labels it **model confidence**.
- `< 0.7` is **low**. Low-confidence fields are visually marked, never hidden, and listed explicitly when the reviewer accepts the item in one keystroke. Missing confidence is treated as low.
- Confidence never gates publication by itself; a human decision does. Rejecting a field is a decision and is recorded.
- When the provider returns a malformed or missing date and the adapter coerces it instead of failing, the coerced date carries precision `unknown` and confidence `0`, so review always marks it low.

## 4. Transcription

- Transcribe what is written, preserving spelling, capitalisation and line breaks. Do not modernise, correct or translate.
- Mark illegible words as `[illegible]`. Never guess a word and present it as read.
- If the item has no writing, `transcription` is `null`, not an empty string and not a description of the image.
- The description describes what is visible, without identifying people or asserting a location the record does not support.

## 5. Rights and provenance

- Every published item carries a rights line. Accepted forms: `No known copyright restrictions.` or the institution's supplied statement. Never assert public domain without a source.
- Provenance is mandatory and visible: `sha256`, original file name, model identifier, prompt version, extraction timestamp, reviewer, publication timestamp.
- Only the normalised JPEG — longest side 2048 px, quality 88 — is retained; the uploaded original is discarded after normalisation. The retained copy is never modified or deleted after ingest, and every derivative, whether thumbnail, crop or display size, is regenerated from it.

## 6. Dublin Core export

One row per published item, headers exactly:

`dc.title, dc.creator, dc.date, dc.description, dc.subject, dc.identifier, dc.source, dc.rights, dc.type`

- `dc.title` — record title.
- `dc.creator` — confirmed people, semicolon-separated, display form.
- `dc.date` — `date_display` verbatim.
- `dc.description` — description, then transcription when present, separated by a blank line.
- `dc.subject` — confirmed subjects and places, semicolon-separated.
- `dc.identifier` — the item's public identifier (`RVN-0001`).
- `dc.source` — original file name, plus the source collection identifier when known.
- `dc.rights` — the item's rights line.
- `dc.type` — `StillImage`.

CSV is RFC 4180 quoted through `papaparse`; the round-trip is a tested property.

## 7. Citation

```
{title}, {date_display}. {institution}, {identifier}. {absolute item URL}
```

Omit a missing element and its separator rather than emitting `undefined` or an empty pair of commas. The URL is absolute and stable.

## 8. Identifiers

Public identifiers are `RVN-` followed by a zero-padded sequence (`RVN-0001`). Internal ids are opaque and may change; the public identifier does not.

## 9. Ingest

- Identity is the normalised pixels, not the upload: `sha256` is computed over the normalised JPEG, so two files that normalise to the same bytes are one item whatever their names or formats. The stored copy is `uploads/<sha256>.jpg` relative to the data directory.
- Normalisation is EXIF-rotated, fitted inside 2048x2048 without enlargement, JPEG quality 88. Inputs over 50 megapixels are rejected before decoding, and files that declare a HEIF brand (`heic`, `heix`, `hevc`, `hevx`) in the `ftyp` box, as major or compatible brand, are refused with an explanation rather than handed to the decoder.
- An uploaded item is `queued`. Ingest never produces `extracting`, `needs_review`, `published` or `rejected`; extraction and review own those transitions. No surface may call an upload extracted, catalogued or saved to the archive — the only true status is queued.
- Status values are exactly `queued | extracting | needs_review | published | rejected`.
- Audit rows are append-only: ingest writes `ingest` for a new item and `duplicate_ingest` for a known hash, with actor and before/after JSON. No code path updates or deletes an audit row.
- `POST /api/admin/ingest` answers 401 unauthenticated, 411 no declared length, 400 for a form that cannot be read or fails validation, 413 over the limit, 422 undecodable or unsupported, 500 for a storage, configuration or unexpected failure, 503 database busy after one retry, and 200 for queued or duplicate. Error bodies carry `{ code, message }` and never exception text.
- The data directory is created and write-probed at boot, so a directory that cannot be written stops the server. The upload route repeats the check when it first opens the database; a directory that turns unwritable after boot fails the upload with 500.
