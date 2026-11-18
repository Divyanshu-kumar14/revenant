import type { ItemStatus } from "@/db/types";

/** The editable fields as the screen holds them: text, and one name per entity. */
export interface ReviewFormValues {
  title: string;
  description: string;
  transcription: string;
  dateDisplay: string;
  people: string[];
  places: string[];
  subjects: string[];
}

export type ReviewActionName = "accept" | "edit" | "reject" | "reopen";

export interface SubmitInput extends ReviewFormValues {
  itemId: string;
  action: ReviewActionName;
}

export type SubmitResult =
  | { ok: true; status: ItemStatus }
  | { ok: false; code: string; fields?: Record<string, string>; message: string };
