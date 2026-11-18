// Type-only and erased at runtime: records.date_precision's CHECK and PRECISIONS are the same ten
// values, so a drift between them should be a type error. src/db gains no runtime dependency.
import type { Precision } from "@/extract/provider";

export type ItemStatus = "queued" | "extracting" | "needs_review" | "published" | "rejected";

export type EntityType = "person" | "place" | "subject";

/** A row of `items`, with the database's snake_case column names. */
export interface ItemRow {
  id: string;
  sha256: string;
  file_name: string;
  stored_path: string;
  caption: string | null;
  status: ItemStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of `records`, with the database's snake_case column names. */
export interface RecordRow {
  item_id: string;
  title: string | null;
  description: string | null;
  transcription: string | null;
  date_start: string | null;
  date_end: string | null;
  date_display: string | null;
  date_precision: Precision;
  confidence_json: string | null;
  reviewed_by: string | null;
  published_at: string | null;
}
