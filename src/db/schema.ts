/**
 * Revenant schema. Idempotent: every statement is safe to run twice.
 * Kept in TypeScript, not a .sql file, because Turbopack turns a `new URL("./schema.sql",
 * import.meta.url)` into a hashed static asset in page bundles, where readFileSync cannot read it.
 */
export const SCHEMA_SQL = `-- Revenant schema. Idempotent: every statement is safe to run twice.
-- Timestamps are ISO 8601 UTC text. Dates are YYYY-MM-DD text.

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  sha256      TEXT NOT NULL UNIQUE,
  file_name   TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  caption     TEXT,
  status      TEXT NOT NULL
              CHECK (status IN ('queued','extracting','needs_review','published','rejected')),
  error       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS items_status_idx ON items(status);

CREATE TABLE IF NOT EXISTS extractions (
  id         TEXT PRIMARY KEY,
  item_id    TEXT NOT NULL REFERENCES items(id),
  model      TEXT NOT NULL,
  raw_json   TEXT NOT NULL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  -- Last, matching the column order of a database migrated by the ALTER in client.ts migrate().
  prompt_version TEXT NOT NULL DEFAULT 'v1'
);
CREATE INDEX IF NOT EXISTS extractions_item_idx ON extractions(item_id);

CREATE TABLE IF NOT EXISTS records (
  item_id         TEXT NOT NULL UNIQUE REFERENCES items(id),
  title           TEXT,
  description     TEXT,
  transcription   TEXT,
  date_start      TEXT,
  date_end        TEXT,
  date_display    TEXT,
  date_precision  TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (date_precision IN
                    ('day','month','year','decade','season','circa','range','before','after','unknown')),
  confidence_json TEXT,
  reviewed_by     TEXT,
  published_at    TEXT,
  -- Lower bound from archive-conventions §1; the upper bound (currentYear + 1)
  -- moves every year and is enforced by the date normaliser.
  CHECK (date_start IS NULL OR date_start >= '1800-01-01'),
  CHECK (date_end IS NULL OR date_end >= '1800-01-01'),
  CHECK (date_start IS NULL OR date_end IS NULL OR date_start <= date_end)
);

CREATE TABLE IF NOT EXISTS entities (
  id       TEXT PRIMARY KEY,
  type     TEXT NOT NULL CHECK (type IN ('person','place','subject')),
  name     TEXT NOT NULL,
  name_key TEXT NOT NULL,
  UNIQUE (type, name_key)
);

CREATE TABLE IF NOT EXISTS item_entities (
  item_id    TEXT NOT NULL REFERENCES items(id),
  entity_id  TEXT NOT NULL REFERENCES entities(id),
  role       TEXT NOT NULL,
  confidence REAL,
  PRIMARY KEY (item_id, entity_id, role)
);
CREATE INDEX IF NOT EXISTS item_entities_entity_idx ON item_entities(entity_id);

CREATE TABLE IF NOT EXISTS places (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id),
  lat       REAL,
  lng       REAL,
  source    TEXT,
  cached_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES items(id),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  before_json TEXT,
  after_json  TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_item_idx ON audit_events(item_id, created_at);

CREATE TABLE IF NOT EXISTS eval_runs (
  id           TEXT PRIMARY KEY,
  fixture_set  TEXT NOT NULL,
  model        TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
`;
