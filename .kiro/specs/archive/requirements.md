# Requirements — Archive

## Introduction

The archive is the product's public face: what a family, a researcher or a journalist sees. It contains only reviewed records, and every page answers three questions — what is this, where did it come from, and how do I cite it.

## Requirements

### Requirement 1: Browse published records

**User Story:** As a visitor, I want to browse what the institution has published, so that I can find material without knowing the catalogue.

#### Acceptance Criteria

1. WHEN a visitor opens `/` THEN the system SHALL show the institution name, a search field, and the most recently published items.
2. WHEN no records are published THEN the system SHALL show an empty state that explains the archive is being catalogued, not a broken grid.
3. WHEN a record is not `published` THEN no public surface SHALL include it, enumerate it, or reveal its existence through counts.

### Requirement 2: Read an item

**User Story:** As a researcher, I want a stable item page with the image, description and provenance, so that I can trust and cite it.

#### Acceptance Criteria

1. WHEN a visitor opens `/items/[id]` for a published item THEN the system SHALL show the image, title, description, transcription when present, date display, people, places, subjects and the rights line.
2. WHEN the item has a provenance record THEN the system SHALL show sha256, original file name, model, prompt version, extraction timestamp, reviewer and publication timestamp.
3. WHEN the id is unknown or unpublished THEN the system SHALL return `404`.
4. WHEN the stored image is missing THEN the system SHALL show a labelled unavailable-image state and SHALL keep the text visible.
5. WHEN the item has coordinates THEN the system SHALL show a map link; when it does not, it SHALL show nothing rather than a guessed location.

### Requirement 3: Cite the item

**User Story:** As a researcher, I want a formatted citation I can paste, so that using the item does not require assembling metadata by hand.

#### Acceptance Criteria

1. WHEN a visitor views an item THEN the system SHALL show a citation in the form `{title}, {date_display}. {institution}, {identifier}. {absolute URL}`.
2. WHEN a citation element is missing THEN the system SHALL omit that element and its separator, never printing `undefined` or an empty pair of commas.
3. WHEN the visitor activates "Copy citation" THEN the exact citation text SHALL be on the clipboard and the action SHALL be announced.
4. WHEN the same item is cited from the CSV export or the API THEN the identifier and URL SHALL match the item page.

### Requirement 4: Search and facet

**User Story:** As a visitor, I want to search names, places and words from the transcription, so that I can find an item by what is written on it.

#### Acceptance Criteria

1. WHEN a query is submitted THEN the system SHALL search title, description, transcription, people and places, and SHALL return only published items.
2. WHEN a title matches the query exactly THEN that hit SHALL rank before other matches.
3. WHEN results are shown THEN the system SHALL offer facets for decade, person and place, counted over the filtered result set.
4. WHEN a facet is applied THEN the result count and the other facet counts SHALL reflect the combined filters.
5. WHEN the query contains FTS syntax characters THEN the system SHALL escape them and SHALL NOT return a database error.
6. WHEN a query returns nothing THEN the system SHALL suggest removing a facet before suggesting a different archive.

### Requirement 5: Map the places

**User Story:** As a visitor, I want to see where the photographs were taken, so that the collection becomes a geography rather than a list.

#### Acceptance Criteria

1. WHEN a place has cached coordinates THEN the map SHALL show a pin linking to the filtered results for that place.
2. WHEN a place has no cached coordinates or geocoding was ambiguous THEN the map SHALL NOT invent a location.
3. WHEN geocoding runs THEN it SHALL use a descriptive User-Agent, at most one request per second, and SHALL cache both hits and misses in `places`.
4. WHEN the map is displayed THEN it SHALL include OpenStreetMap attribution and SHALL be usable without a mouse for the list of places.

### Requirement 6: Export Dublin Core

**User Story:** As a cataloguer, I want a CSV that my existing catalogue can ingest, so that Revenant does not become another silo.

#### Acceptance Criteria

1. WHEN an administrator requests `/api/export` THEN the system SHALL stream a CSV with the headers fixed in `.kiro/steering/archive-conventions.md`.
2. WHEN a row is exported THEN `dc.identifier` and `dc.date` SHALL match the item page exactly.
3. WHEN a field contains a comma, quote or newline THEN the output SHALL be RFC 4180 quoted and SHALL round-trip through `papaparse`.
4. WHEN no items are published THEN the export SHALL contain the header row and no data rows.

### Requirement 7: Accessible and fast

**User Story:** As any visitor, I want the archive to work on a phone and with assistive technology.

#### Acceptance Criteria

1. WHEN axe-core scans `/`, `/search`, `/items/[id]` and `/map` THEN there SHALL be zero serious or critical violations.
2. WHEN the pages are measured with Lighthouse on a production build THEN Performance SHALL be at least 90 and Accessibility at least 95.
3. WHEN `prefers-reduced-motion` is set THEN no transition or map animation SHALL run.
4. WHEN JavaScript is unavailable THEN item text, search results and citations SHALL still be server-rendered.
