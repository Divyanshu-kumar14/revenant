# ADR 0001 — The extraction promise

**Status:** OPEN — no provider selected, no measurements taken
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

Fill this table after the run. Do not edit the scoring rule after seeing the results.

| # | Source id | Date verdict | Names verdict | Invented field? | Notes |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |
| 13 | | | | | |
| 14 | | | | | |
| 15 | | | | | |
| 16 | | | | | |
| 17 | | | | | |
| 18 | | | | | |
| 19 | | | | | |
| 20 | | | | | |

**Totals:** dates __ / 20 correct · names __ / 20 correct · invented names __ / 20

**Provider and model:** _not selected_
**Prompt version:** _not written_
**Run at:** _not run_

## Consequences

Until this ADR has totals, the only permitted claim in any public artifact is "assisted cataloguing under mandatory review". The README already says the archive is not live and that no accuracy number exists yet. Keep it that way.
