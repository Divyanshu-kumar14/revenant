# Requirements — Review

## Introduction

Review is the product's ethical centre: a model proposes fields, a volunteer decides, and nothing reaches the public archive without that decision. The screen must be faster than a spreadsheet for a person who reviews two hundred items in an afternoon.

## Requirements

### Requirement 1: Restrict review to an administrator

**User Story:** As the institution, I want only authorised volunteers to change records, so that the public archive cannot be edited by a visitor.

#### Acceptance Criteria

1. WHEN an unauthenticated request reaches `/admin/**` or `/api/admin/**` THEN the system SHALL redirect to `/admin/login` or return `401`, and SHALL NOT reveal item content.
2. WHEN the correct password is submitted THEN the system SHALL set an `httpOnly`, `sameSite=lax`, signed session cookie that expires after 12 hours; in production the cookie SHALL also be `secure`.
3. WHEN the password is wrong THEN the system SHALL return a generic failure, SHALL compare in constant time, and SHALL allow at most five attempts per IP per fifteen minutes.
4. WHEN the session signature is missing, malformed or expired THEN the system SHALL treat the request as unauthenticated.
5. WHEN the user logs out THEN the system SHALL clear the cookie.

### Requirement 2: Show the item and the proposal together

**User Story:** As a reviewer, I want the photograph and the proposed record side by side, so that I can verify rather than remember.

#### Acceptance Criteria

1. WHEN an item is opened for review THEN the system SHALL show the normalised image, the transcription, and every proposed field with its value.
2. WHEN the image fails to load THEN the system SHALL show a labelled broken-source state and SHALL still allow review of the text.
3. WHEN an item has no transcription THEN the system SHALL say "no writing detected" rather than showing an empty box.
4. WHEN extraction failed THEN the system SHALL show the error code and allow the reviewer to edit fields manually or reject the item.

### Requirement 3: Expose uncertainty

**User Story:** As a reviewer, I want to see which fields the model was unsure about, so that I spend my attention where it matters.

#### Acceptance Criteria

1. WHEN a field has a confidence value THEN the system SHALL display it labelled as model confidence, not as a probability of correctness.
2. WHEN confidence is below 0.7 or absent THEN the system SHALL mark the field as low confidence with text, not colour alone.
3. WHEN an item is accepted THEN the confirmation SHALL name the low-confidence fields that were accepted, in an `aria-live` region.

### Requirement 4: Decide with the keyboard

**User Story:** As a reviewer, I want to accept, edit or reject without reaching for the mouse, so that a batch of two hundred is bearable.

#### Acceptance Criteria

1. WHEN the review screen has focus THEN `J` and `K` SHALL move to the next and previous item in the queue.
2. WHEN the reviewer presses `Enter` on a valid record THEN the system SHALL publish it and advance to the next item.
3. WHEN the reviewer presses `E` THEN the fields SHALL become editable with focus on the title; `Escape` SHALL cancel without saving.
4. WHEN the reviewer presses `X` THEN the system SHALL reject the item after a confirmation, and SHALL remove it from the public archive if it was published.
5. WHEN a reviewer rejects an item THEN an administrator SHALL be able to reopen it to `needs_review`, recorded as a `reopen` audit event.
6. WHEN the record lacks a title or a date display THEN accept SHALL fail with a field-level message and SHALL NOT publish.
7. WHEN `?` is pressed THEN the system SHALL show the shortcut list; `Escape` SHALL close it and return focus.

### Requirement 5: Every decision is auditable

**User Story:** As an archivist, I want to know who changed what and when, so that a published record can be defended.

#### Acceptance Criteria

1. WHEN an item is accepted, edited, rejected, reopened or re-extracted THEN the system SHALL write an `audit_events` row with actor, action, before JSON, after JSON and timestamp.
2. WHEN the same field is edited twice THEN both events SHALL remain; audit rows are append-only.
3. WHEN an item is published THEN `records.reviewed_by` and `records.published_at` SHALL be set in the same transaction as the status change.

### Requirement 6: Publish only reviewed records

**User Story:** As the institution, I want a guarantee that nothing unreviewed is public, so that the archive is trustworthy.

#### Acceptance Criteria

1. WHEN a record has status other than `published` THEN no public route SHALL return it, including search, facets, map, export and the item page.
2. WHEN a record is published THEN it SHALL appear in search and export within one request, with no cache invalidation step required by the user.
3. WHEN a published item is rejected THEN it SHALL disappear from every public surface on the next request.
4. WHEN the database is seeded for a demo THEN seeded records SHALL be marked published with a named reviewer and a fixed timestamp.

### Requirement 7: Accessible and fast

**User Story:** As a volunteer using a screen reader or a small laptop, I want the review flow to work without a mouse and without motion.

#### Acceptance Criteria

1. WHEN the review screen is used with a keyboard only THEN every action SHALL be reachable in a logical tab order.
2. WHEN `prefers-reduced-motion` is set THEN no transition or animation SHALL run.
3. WHEN text is zoomed to 200% THEN the image and fields SHALL remain usable without horizontal scrolling of the page.
4. WHEN axe-core scans the review screen THEN there SHALL be zero serious or critical violations.
