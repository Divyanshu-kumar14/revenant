export type ItemStatus = "queued" | "extracting" | "needs_review" | "published" | "rejected";

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
