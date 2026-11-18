"use server";

import { requireAdminPage } from "@/auth/gate";
import { resolveDataDir } from "@/data-dir";
import { getLatestExtraction } from "@/db/queries";
import { serverDb } from "@/db/server";
import { deriveProposal } from "@/extract/extract-item";
import { normalizeDate } from "@/normalize/date";
import { nameKey } from "@/normalize/names";
import { reviewItem, type ReviewFields } from "@/review/actions";
import { ConcurrentChange, ItemNotFound, ReviewValidationError } from "@/review/errors";
import { InvalidTransition } from "@/review/state";
import type { SubmitInput, SubmitResult } from "@/components/review/types";

/**
 * Thin wrapper over `reviewItem`, which is synchronous and takes a db handle and so cannot live
 * in a "use server" file. The date display is the only date input: it is re-normalised here and
 * the bounds and precision come from that. Confidence is never typed; a submitted name keeps the
 * proposal's confidence for the same name key, and a name the reviewer added gets 0 (low).
 */
export async function submitReview(input: SubmitInput): Promise<SubmitResult> {
  const session = await requireAdminPage();
  const db = serverDb(resolveDataDir());

  let proposal: ReturnType<typeof deriveProposal> | null = null;
  const latest = getLatestExtraction(db, input.itemId);
  if (latest) {
    try {
      proposal = deriveProposal(latest.rawJson);
    } catch {
      proposal = null;
    }
  }

  const known = new Map<string, number>();
  for (const entity of [...(proposal?.people ?? []), ...(proposal?.places ?? []), ...(proposal?.subjects ?? [])]) {
    known.set(entity.nameKey, Math.max(known.get(entity.nameKey) ?? 0, entity.confidence));
  }
  const withConfidence = (names: string[]) =>
    names.map((name) => ({ name, confidence: known.get(nameKey(name)) ?? 0 }));

  const date = normalizeDate(input.dateDisplay);
  const fields: ReviewFields = {
    title: input.title,
    description: input.description,
    transcription: input.transcription,
    dateDisplay: date.display,
    dateStart: date.start,
    dateEnd: date.end,
    datePrecision: date.precision,
    people: withConfidence(input.people),
    places: withConfidence(input.places),
    subjects: withConfidence(input.subjects),
    confidence: proposal?.confidence ?? {},
  };

  try {
    // reviewItem reads fields only for accept and edit; reject and reopen get the bare decision.
    const withFields = input.action === "accept" || input.action === "edit";
    const outcome = reviewItem(db, {
      itemId: input.itemId,
      action: input.action,
      actor: session.actor,
      ...(withFields ? { fields } : {}),
    });
    return { ok: true, status: outcome.status };
  } catch (error) {
    if (error instanceof ReviewValidationError) {
      return { ok: false, code: error.code, fields: error.fields, message: "Some fields need attention." };
    }
    if (error instanceof ItemNotFound || error instanceof InvalidTransition || error instanceof ConcurrentChange) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
