# Requirements — Ingest

## Introduction

Ingest turns a photograph of a collection item into a queued, deduplicated item with a stored derivative and an audit trail. It is the only entry point for new material and the first place where a volunteer can lose work, so every failure must be visible and recoverable.

## Requirements

### Requirement 1: Accept a photograph

**User Story:** As a volunteer, I want to add a photograph of an item from my phone or laptop, so that it enters the catalogue without any metadata knowledge.

#### Acceptance Criteria

1. WHEN a user submits a file whose content is JPEG, PNG, WebP or TIFF THEN the system SHALL accept it, regardless of the file extension.
2. WHEN a user submits a file larger than 25 MB THEN the system SHALL reject it before reading the whole body into memory and SHALL return a message naming the limit.
3. WHEN a user submits a HEIC/HEIF file THEN the system SHALL reject it with a message explaining that the phone must share it as JPEG, because the deployed image decoder does not decode HEVC.
4. WHEN a user submits a file that is not a decodable image THEN the system SHALL reject it with a message that names the file and does not create an item.
5. WHEN a submission includes a typed caption THEN the system SHALL store the caption verbatim on the item.

### Requirement 2: Normalise the stored image

**User Story:** As an archivist, I want the stored derivative to be upright and predictable, so that the reviewer and the model see the same image.

#### Acceptance Criteria

1. WHEN an image carries an EXIF orientation THEN the system SHALL apply the rotation and store the result with orientation 1.
2. WHEN an image is larger than 2048 px on either axis THEN the system SHALL downscale it to fit inside 2048 × 2048 without enlarging smaller images.
3. WHEN an image is normalised THEN the system SHALL store it as JPEG at quality 88 under `$REVENANT_DATA_DIR/uploads/<sha256>.jpg`.
4. WHEN normalisation fails THEN the system SHALL leave no partial file in `uploads/` and SHALL return an error naming the stage.

### Requirement 3: Deduplicate by content

**User Story:** As a volunteer, I want to upload the same box twice without creating duplicate records, so that the archive stays trustworthy.

#### Acceptance Criteria

1. WHEN two submissions have identical normalised bytes THEN the system SHALL create exactly one item.
2. WHEN a duplicate is submitted THEN the system SHALL return the existing item id, SHALL NOT enqueue extraction, and SHALL write an `audit_events` row with action `duplicate_ingest`.
3. WHEN a file is renamed but its bytes are unchanged THEN the system SHALL treat it as a duplicate.
4. WHEN two different files produce the same sha256 THEN the system SHALL treat the second as a duplicate; the hash is the identity.

### Requirement 4: Queue extraction

**User Story:** As a volunteer, I want accepted uploads to wait in a queue, so that I can add a whole box before the model runs.

#### Acceptance Criteria

1. WHEN an item is accepted THEN the system SHALL create it with status `queued` and SHALL NOT call the model during the upload request.
2. WHEN the batch runner claims an item THEN the system SHALL set status `extracting` inside the same transaction that selects it, so that two workers cannot claim one item.
3. WHEN an item is queued THEN the system SHALL expose its status and creation time to the admin queue without loading the image.

### Requirement 5: Survive failure

**User Story:** As a volunteer, I want a failed upload or extraction to be visible, so that I can retry instead of wondering what disappeared.

#### Acceptance Criteria

1. WHEN an upload fails after the bytes are received THEN the system SHALL NOT create a partial item row.
2. WHEN extraction fails THEN the item SHALL move to `needs_review` with an `error` string containing the error code, and SHALL NOT gain a `records` row.
3. WHEN a user retries a failed item THEN the system SHALL allow it without creating a second item or a second upload.
4. WHEN any status changes THEN the system SHALL write an `audit_events` row with actor, action, before and after.

### Requirement 6: Provenance at ingest

**User Story:** As an archivist, I want to know where each file came from, so that a published record can be defended.

#### Acceptance Criteria

1. WHEN an item is created THEN the system SHALL store `sha256`, original `file_name`, `stored_path`, `caption`, `created_at` and `updated_at`.
2. WHEN an item is published THEN its provenance SHALL remain unchanged except for status, review fields and publication time.
3. WHEN a stored file is missing at read time THEN the item page SHALL show a broken-source state rather than a silent blank image.
