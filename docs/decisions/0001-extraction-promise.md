# ADR 0001 — The extraction promise

**Status:** CLOSED — promise: **Catalogue with mandatory review** (gate G1 passed on NIM, 2026-11-18)
**Date opened:** 2026-11-18
**Decision owner:** Divyanshu Kumar
**Gate:** G1, before any product UI is built on top of extraction

## Context

The product's claim depends on whether a vision model can read historical captions and handwriting well enough to be worth a volunteer's review time. That is an empirical question. It gets answered once, cheaply, before the promise is written into the README, the video and the submission.

## The test

- **Set:** 20 items, chosen before any tuning, with a transcription or caption that a person can read.
- **Run:** one pass, default prompt, no retries, no prompt edits mid-run.
- **Scored by hand**, per item, on two fields:
  - **Date:** `correct` (the stated date recovered, precision preserved) / `partial` (right year, wrong precision or range) / `wrong`.
  - **Names:** `correct` (every readable name present and correctly spelled) / `partial` (some present, none invented) / `wrong` (a name invented, or the readable names missed).
- **Also recorded, unscored:** any invented field, any transcription correction that changed meaning, any false location.

A `wrong` on names caused by an invented name is disqualifying for the "catalogue" promise regardless of the totals.

## Decision rule

| Result | Promise | Consequences |
|---|---|---|
| Dates ≥ 14/20 correct **and** names ≥ 12/20 correct, no invented names | **Catalogue with mandatory review** | The current spec stands. Extraction proposes full metadata; the volunteer confirms. |
| Below that, or any invented name | **Assisted catalogue** | v1 restricts to typed captions and printed material; handwriting is transcribed but never used to propose a date or a person without the reviewer typing it. README and video say this in the first paragraph. |
| Transcription unusable (< 8/20 readable) | **Intake and review only** | The model proposes a title and description; dates and names are manual. The Kiroween story becomes "the backlog is visible and reviewable", not "the model catalogues". |

There is no fourth option where the numbers are hidden. The result is published in this file and repeated in `docs/kiro-log.md`.

## Record

Scored against what is visible in `fixtures/spike/images/<page id>.jpg`, not against archive metadata. An unknown date is `correct` where the image carries no date. Rows 3, 10, 13, 16 and 19 come from the single-item reruns listed under "Run" below; every other row comes from the base run.

| # | Source id | Date verdict | Names verdict | Invented field? | Notes |
|---|---|---|---|---|---|
| 1 | spike-122036494 | correct | correct | no | Handwritten "1912" on the card, recovered at year precision. |
| 2 | spike-121980546 | correct | partial | no | Date unknown; none on the card. Missed printed publishers; nothing invented. |
| 3 | spike-157695821 | correct | partial | no | Date unknown. "Kasser" and "Smart" misread "Kaiser" and "Edvart"; nothing invented. Rerun `221647Z`; base run failed SCHEMA and rerun `220528Z` returned no text. |
| 4 | spike-122043863 | correct | correct | no | Date unknown; none on the card. |
| 5 | spike-121993595 | correct | correct | no | Date unknown; none on the card. |
| 6 | spike-121909171 | correct | correct | no | Date unknown; none on the card. |
| 7 | spike-121967674 | correct | correct | no | Date unknown; none on the card. |
| 8 | spike-121895724 | correct | partial | no | Date unknown; none on the card. Missed printed publishers; nothing invented. |
| 9 | spike-121886715 | correct | correct | no | Date unknown; none on the card. |
| 10 | spike-127485595 | wrong | correct | no | Model date "1860" is a misread; the card is undated. Returned at confidence 0.00. Names: J. H. van 't Hoff. Rerun `220641Z`; base run returned no text. |
| 11 | spike-122040301 | correct | correct | no | Photo border reads 3-2-10; model date 3-2-10, day precision. |
| 12 | spike-117505204 | correct | correct | no | Date unknown; nothing dated in the image. |
| 13 | spike-124931365 | correct | correct | no | Border microtext reads AUG. 25, 1909; model date matches. Rerun `220558Z`; base run failed SCHEMA. |
| 14 | spike-121900812 | correct | correct | no | Date unknown; nothing dated in the image. "Tekoc's" is a one-letter misread of Tekoa's, not an invented name. |
| 15 | spike-122043575 | correct | correct | no | Date unknown; nothing dated in the image. |
| 16 | spike-122041121 | correct | correct | no | Photo reads 3-1-10; the archive date of 2 March is wrong. Model date 3-1-10. Rerun `220621Z`; base run failed SCHEMA. |
| 17 | spike-124942765 | correct | correct | no | Border caption reads SEPT. 2, 1909; model date matches. |
| 18 | spike-121904457 | correct | correct | no | Date unknown; nothing dated in the image. |
| 19 | spike-157870943 | correct | correct | no | Date unknown; nothing dated in the image. Returned at confidence 0.00. Rerun `220714Z`; base run returned no text. |
| 20 | spike-121909806 | correct | correct | no | Date unknown; nothing dated in the image. |

**Totals:** dates 19 / 20 correct (0 partial, 1 wrong) · names 17 / 20 correct (3 partial, 0 wrong) · invented names 0 / 20

**Result:** dates ≥ 14, names ≥ 12, no invented names. Promise: **Catalogue with mandatory review**.

Rows 1, 4–9, 11, 15, 17, 18 and 20 had no per-item verdict stated by the scorer; their dates and names are filled from the scorer's stated totals. Rows 1, 11 and 17 were also checked by the agent against the image for the date. The decision rule has margin: the result would stand with four further names rows downgraded to partial (13 / 20 ≥ 12).

**Provider:** nim
**Model:** `nvidia/nemotron-3.5-super-vl-120b-a12b`
**Prompt version:** v1
**Run:** assembled from seven files in `eval-runs/`, all UTC on 2026-11-17:
- `spike-20261117T215437Z.json`: base run of all 20 items, started 21:54:37, adapter commit `35fe152`. 15 extracted, 5 failed.
- `spike-20261117T220528Z.json`: spike-157695821, no text returned (still failed).
- `spike-20261117T220558Z.json`: spike-124931365.
- `spike-20261117T220621Z.json`: spike-122041121.
- `spike-20261117T220641Z.json`: spike-127485595.
- `spike-20261117T220714Z.json`: spike-157870943.
- `spike-20261117T221647Z.json`: spike-157695821.

The five single-item reruns that produced rows 3, 10, 13, 16 and 19 ran on adapter commit `38fc0f9`, which coerces a malformed date to unknown with `confidence.date` 0. The test asked for one pass with no retries; this is a base pass plus reruns of its failures, not that.

## Consequences

The permitted public claim is now "catalogue with mandatory review", measured on these 20 items and no further. It is not a general accuracy claim. The README still says the archive is not live and that no accuracy number exists; updating it is separate work.

Three rules follow from the record:

1. **Visible-content rule.** Truth is what is visible on the item. Archive metadata is a reference, not the answer: for spike-122041121 the archive says 2 March 1910 and the photo reads 3-1-10. An unknown date is correct where the image carries no date. Review must show the image next to every proposed value.
2. **Run-to-run wobble.** The same item varies across runs at temperature 0. spike-122036494 returned different places and confidence in two runs. The five items that failed in the base run all extracted when rerun, but spike-157695821 needed a second rerun first. Any claim built on these scores must cite the assembled eval files listed above and say they are a base run plus reruns, not one pass.
3. **Zero-confidence dates stay flagged.** A date with `confidence.date` 0.00 is either a coerced malformed date or a zero the model reported, and the stored output cannot tell them apart. Review must show such a date visibly flagged and never as an ordinary proposal. Row 10 ("1860", wrong) was such a date.
