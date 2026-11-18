# Requirements — Extract

## Introduction

Extraction turns a queued item into a proposal a volunteer can review. It owns the path `queued → extracting → needs_review` and nothing after it. It sends the stored image to a vision model, keeps the model's output with its provenance, and hands the item to review whether the model succeeded or not. It never publishes, never writes the confirmed record, and never claims more accuracy than ADR 0001 measured.

## Requirements

### Requirement 1: Claim an item without double work

**User Story:** As a volunteer, I want each photograph sent to the model once, so that a second run or a second click does not cost time or produce two competing proposals.

#### Acceptance Criteria

1. WHEN a run claims an item THEN the system SHALL change its status from `queued` to `extracting` with one `UPDATE ... WHERE status = 'queued'` inside `BEGIN IMMEDIATE`.
2. WHEN that update changes zero rows THEN the run SHALL treat the item as owned by another run and SHALL NOT call the model for it.
3. WHEN two runs start at the same time on the same queue THEN each item SHALL be sent to the model by at most one of them.
4. WHEN a run drains the queue THEN it SHALL claim items oldest first, by `created_at` and then `id`.
5. WHEN the model is called THEN no database transaction SHALL be open, so a slow model never holds the write lock.
6. WHEN an item is in any status other than `queued` THEN extraction SHALL NOT claim it.

### Requirement 2: Record the provenance of every proposal

**User Story:** As an archivist, I want to know which model and prompt produced each proposal, so that a published record can be defended.

#### Acceptance Criteria

1. WHEN extraction succeeds THEN the system SHALL write exactly one `extractions` row with `item_id`, `model`, `prompt_version`, `raw_json`, `latency_ms` and `created_at`.
2. WHEN the row is written THEN `raw_json` SHALL hold the model's final response text exactly as received: the first response, or the repair response when the repair call was used. It SHALL NOT be a reformatted, validated or normalised copy.
3. WHEN the row is written THEN `prompt_version` SHALL be the extractor's `promptVersion`, never the column default.
4. WHEN extraction succeeds THEN the `extract` audit row's `after_json` SHALL record `repaired` (the repair call was used) and `coerced` (the NIM adapter salvaged an invalid date).
5. WHEN a proposal is shown THEN the system SHALL compute it from `raw_json` with a pure function, so the same row always yields the same proposal for the same `now`.
6. WHEN an `extractions` row exists THEN no code path SHALL update or delete it.

### Requirement 3: Enforce the archive conventions on the proposal

**User Story:** As a reviewer, I want proposed dates and names already in the archive's form, so that I check content instead of fixing formats.

#### Acceptance Criteria

1. WHEN the model's structured `start` and `end` are valid under archive conventions §1 (real `YYYY-MM-DD` dates, years within `1800..currentYear + 1`, `start <= end`, precision other than `unknown`) THEN the proposal SHALL use them and their precision, and SHALL render `date_display` from them per §1 rule 9.
2. WHEN the structured fields are absent or invalid THEN the system SHALL parse the display text per §1, including the two-digit pivot of 30 and the D/M rule; the display text SHALL NOT be parsed for any other purpose.
3. WHEN the display text's own parse disagrees with the structured year THEN the proposal SHALL keep the structured date and SHALL set `ambiguous: true`.
4. WHEN the model returns display `3-2-10` with structured start and end `1910-03-02` at precision `day` (ADR 0001 row 11) THEN the proposal SHALL be `March 2, 1910`, start and end `1910-03-02`, `ambiguous: true`, and SHALL NOT be 2010.
5. WHEN neither the structured fields nor the display text yield a valid date THEN the proposal SHALL carry precision `unknown`, `null` bounds, and the trimmed original as `date_display`.
6. WHEN the date object in `raw_json` fails the extraction schema (the case the NIM adapter coerces) THEN the proposal SHALL carry precision `unknown` and confidence `0`, so review marks it low (§3), and SHALL NOT parse the display text into a date.
7. WHEN a proposal is derived THEN the system SHALL read a date only from the model's date object, and SHALL NOT derive one from any other field (§1 rule 11).
8. WHEN a proposal contains a name THEN the system SHALL produce `displayName` and `nameKey` per §2: NFKC, trimmed, whitespace collapsed, diacritics and scripts preserved.
9. WHEN a proposal is derived THEN it SHALL contain only names present in `raw_json`; normalisation SHALL NOT add, expand or merge names beyond an identical `nameKey`.
10. WHEN the model reports a confidence THEN the system SHALL pass it through unchanged and SHALL NOT compute, calibrate or adjust any confidence.

### Requirement 4: Failure still reaches review

**User Story:** As a volunteer, I want an item the model could not read to land in my review queue with a reason, so that nothing silently disappears and I can enter the record by hand.

#### Acceptance Criteria

1. WHEN the extractor throws an `ExtractionError` for a claimed item THEN the system SHALL move the item to `needs_review`, set `items.error` to the error's code, write no `extractions` row, and write an `extract_failed` audit row.
2. WHEN any other error occurs for a claimed item (the upload file is missing, the adapter throws something that is not an `ExtractionError`, the finish transaction fails) THEN the system SHALL do the same with `items.error = 'INTERNAL'`.
3. WHEN `items.error` is set THEN it SHALL hold only the code (for example `TIMEOUT` or `INTERNAL`), never an error message or a provider response body.
4. WHEN extraction succeeds THEN the system SHALL set `items.error` to `NULL`.
5. WHEN an item fails THEN the system SHALL NOT requeue or retry it automatically; the adapter's own retries inside one call are the only retries.
6. WHEN a run cannot construct its extractor (`NO_KEY`, `CONFIG`) THEN it SHALL claim no item, leave every item `queued`, and report the code.
7. WHEN a failed item is opened in review THEN the item SHALL already be in the state review Requirement 2 AC4 expects: `needs_review`, an error code, and no proposal.

### Requirement 5: Drain the queue from the command line

**User Story:** As the person running the archive, I want one command that works through the queue and tells me what happened, so that I can run it after a volunteer session and see failures at a glance.

#### Acceptance Criteria

1. WHEN a run starts, from the command or the route, THEN before its first claim the system SHALL return to `queued` every item that has been `extracting` for more than fifteen minutes, writing an `extract_interrupted` audit row for each.
2. WHEN `pnpm extract` runs THEN the system SHALL claim and extract queued items oldest first until none remain or `--limit=<n>` items have been claimed.
3. WHEN `--item=<id>` is given THEN the system SHALL extract only that item if it is `queued`, and otherwise SHALL print its current status and claim nothing.
4. WHEN an item finishes THEN the system SHALL print one line naming the item id and its outcome: the model and prompt version on success, the error code on failure.
5. WHEN the run ends THEN the system SHALL print one summary line with the counts of items requeued, extracted, failed and still queued.
6. WHEN any item failed, or the extractor could not be constructed THEN the command SHALL exit non-zero; otherwise it SHALL exit 0.
7. WHEN the queue is empty THEN the command SHALL return; it SHALL NOT watch, poll or run as a daemon.

### Requirement 6: Trigger a small batch from the admin

**User Story:** As a volunteer, I want to start extraction from the admin screen without a terminal, so that I can process what I just uploaded.

#### Acceptance Criteria

1. WHEN `POST /api/admin/extract` arrives without a valid admin session THEN the system SHALL return `401` and claim nothing.
2. WHEN the request asks for more than the batch bound of five or for a limit that is not a positive integer THEN the system SHALL return `400` and claim nothing.
3. WHEN the request is valid THEN the system SHALL extract at most the requested number of queued items, never more than five, and SHALL return `200` with the counts requeued, claimed, extracted, failed and still queued.
4. WHEN the extractor cannot be constructed THEN the system SHALL return `500` with code `CONFIG` and claim nothing.
5. WHEN the response is built THEN it SHALL NOT contain provider messages, raw model output or file paths.
6. WHEN an upload is accepted THEN the system SHALL NOT start extraction; extraction starts only from this route or the command.

### Requirement 7: Never publish and never overclaim

**User Story:** As the institution, I want a guarantee that the model's output stays a proposal until a person accepts it, so that the archive only says what a human confirmed.

#### Acceptance Criteria

1. WHEN extraction runs THEN it SHALL NOT write `records`, `entities`, `item_entities` or `places`.
2. WHEN extraction runs THEN it SHALL NOT set an item to `published` or `rejected`.
3. WHEN extraction reports an outcome THEN its text SHALL say the item is ready for review, and SHALL NOT call it catalogued, identified or published.
4. WHEN a surface built from this spec shows an accuracy figure THEN the figure SHALL cite the `eval-runs/` file it came from, and SHALL NOT go beyond what ADR 0001 measured.
5. WHEN a confidence is shown THEN it SHALL be labelled model confidence, a self-report, not a calibrated probability.

### Requirement 8: Audit every status change

**User Story:** As an archivist, I want every step an item took through extraction on record, so that an interrupted or failed attempt can be explained later.

#### Acceptance Criteria

1. WHEN a run claims an item THEN the claim transaction SHALL write an `extract_started` audit row with `before` `{ status: "queued" }` and `after` `{ status: "extracting" }`.
2. WHEN a claimed item finishes THEN the finish transaction SHALL write exactly one more row: `extract` on success or `extract_failed` on failure.
3. WHEN a stale item is returned to `queued` THEN the system SHALL write an `extract_interrupted` row in the same transaction.
4. WHEN an attempt runs THEN it SHALL write two audit rows and no more: `extract_started`, then one of `extract`, `extract_failed` or `extract_interrupted`.
5. WHEN an audit row is written THEN it SHALL carry actor, action, before JSON, after JSON and timestamp, and no code path SHALL update or delete it.

### Requirement 9: Run without a provider

**User Story:** As a developer, I want a stand-in extractor for tests and demos, so that review tests and browser tests never spend provider tokens or need a key.

#### Acceptance Criteria

1. WHEN `EXTRACTOR=fixture` THEN the system SHALL use `FixtureExtractor` and SHALL NOT construct a provider adapter.
2. WHEN `FixtureExtractor` extracts THEN it SHALL return a fixed `Extraction` whose text fields are recognisably fake, with model `fixture`, prompt version `fixture`, `repaired: false` and `coerced: false`.
3. WHEN `FixtureExtractor` is given the same input twice THEN it SHALL return equal results, and SHALL NOT call the network.
4. WHEN unit tests or Playwright run THEN they SHALL run with `EXTRACTOR=fixture`.
