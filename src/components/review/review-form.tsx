"use client";

import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import type { ItemStatus } from "@/db/types";
import { ConfidenceBadge } from "./confidence-badge";
import type { ReviewActionName, ReviewFormValues, SubmitInput, SubmitResult } from "./types";

interface Props {
  itemId: string;
  status: ItemStatus;
  initial: ReviewFormValues;
  /** Model confidence by field key: title, description, transcription, date, people, places, subjects. */
  confidence: Record<string, number>;
  dateAmbiguous: boolean;
  position: string;
  submit: (input: SubmitInput) => Promise<SubmitResult>;
}

const STATUS_TEXT: Record<ItemStatus, string> = {
  queued: "Queued",
  extracting: "Extracting",
  needs_review: "Needs review",
  published: "Published",
  rejected: "Rejected",
};

const FIELD_KEYS = ["title", "description", "transcription", "dateDisplay", "dateStart", "dateEnd", "datePrecision", "people", "places", "subjects"];

const labelClass = "font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim";
const inputClass =
  "mt-2 w-full border border-line bg-ink-raised px-3 py-2 text-paper read-only:text-paper-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp";
const buttonClass =
  "cursor-pointer border border-lamp/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-lamp hover:border-lamp disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp";

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function ReviewForm({ itemId, status: initialStatus, initial, confidence, dateAmbiguous, position, submit }: Props) {
  const [status, setStatus] = useState<ItemStatus>(initialStatus);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [transcription, setTranscription] = useState(initial.transcription);
  const [dateDisplay, setDateDisplay] = useState(initial.dateDisplay);
  const [people, setPeople] = useState(initial.people.join("\n"));
  const [places, setPlaces] = useState(initial.places.join("\n"));
  const [subjects, setSubjects] = useState(initial.subjects.join("\n"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [pending, startTransition] = useTransition();

  const editable = status === "needs_review";

  function run(action: ReviewActionName) {
    setErrors({});
    setMessage(null);
    startTransition(async () => {
      const result = await submit({
        itemId,
        action,
        title,
        description,
        transcription,
        dateDisplay,
        people: lines(people),
        places: lines(places),
        subjects: lines(subjects),
      });
      if (result.ok) {
        setStatus(result.status);
        return;
      }
      if (result.code === "UNAUTHORIZED") setSignedOut(true);
      setErrors(result.fields ?? {});
      setMessage(result.message);
    });
  }

  /** Errors whose key is the field or sits under it (`people.0.name`). */
  function errorsFor(...keys: string[]): string[] {
    return Object.entries(errors)
      .filter(([key]) => keys.some((k) => key === k || key.startsWith(`${k}.`)))
      .map(([, text]) => text);
  }

  const otherErrors = Object.entries(errors)
    .filter(([key]) => !FIELD_KEYS.some((k) => key === k || key.startsWith(`${k}.`)))
    .map(([, text]) => text);

  function row(id: string, label: string, confidenceKey: string, control: ReactNode, errorKeys: string[], hint?: ReactNode) {
    const problems = errorsFor(...errorKeys);
    return (
      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor={id} className={labelClass}>
            {label}
          </label>
          <ConfidenceBadge value={confidence[confidenceKey]} />
        </div>
        {control}
        {hint}
        {problems.map((text) => (
          <p key={text} role="alert" className="mt-2 text-sm text-oxblood-text">
            {text}
          </p>
        ))}
      </div>
    );
  }

  const nameHint = <p className="mt-1 text-xs text-paper-dim">One name per line.</p>;

  return (
    <div className="flex min-h-full flex-col">
      <p role="status" className="font-mono text-xs uppercase tracking-[0.14em] text-lamp">
        {STATUS_TEXT[status]}
      </p>

      {status === "published" || status === "rejected" ? (
        <p className="mt-2 text-sm text-paper-dim">
          Item is now {STATUS_TEXT[status].toLowerCase()}.{" "}
          <Link href="/admin" className="text-lamp underline">
            Back to admin
          </Link>
        </p>
      ) : null}

      {dateAmbiguous ? (
        <p className="mt-4 border border-line bg-ink-raised px-3 py-2 text-sm text-paper-dim">
          Ambiguous date: the date text can be read more than one way. Check it before publishing.
        </p>
      ) : null}

      {row(
        "review-title",
        "Title",
        "title",
        <input
          id="review-title"
          className={inputClass}
          value={title}
          readOnly={!editable}
          onChange={(event) => setTitle(event.target.value)}
        />,
        ["title"],
      )}
      {row(
        "review-description",
        "Description",
        "description",
        <textarea
          id="review-description"
          rows={4}
          className={inputClass}
          value={description}
          readOnly={!editable}
          onChange={(event) => setDescription(event.target.value)}
        />,
        ["description"],
      )}
      {row(
        "review-transcription",
        "Transcription",
        "transcription",
        <textarea
          id="review-transcription"
          rows={4}
          className={inputClass}
          value={transcription}
          readOnly={!editable}
          onChange={(event) => setTranscription(event.target.value)}
        />,
        ["transcription"],
      )}
      {row(
        "review-date",
        "Date",
        "date",
        <input
          id="review-date"
          className={inputClass}
          value={dateDisplay}
          readOnly={!editable}
          aria-describedby="review-date-hint"
          onChange={(event) => setDateDisplay(event.target.value)}
        />,
        ["dateDisplay", "dateStart", "dateEnd", "datePrecision"],
        <p id="review-date-hint" className="mt-1 text-xs text-paper-dim">
          Type &ldquo;undated&rdquo; when no date is visible.
        </p>,
      )}
      {row(
        "review-people",
        "People named in the caption or text",
        "people",
        <textarea id="review-people" rows={3} className={inputClass} value={people} readOnly={!editable} onChange={(event) => setPeople(event.target.value)} />,
        ["people"],
        nameHint,
      )}
      {row(
        "review-places",
        "Places",
        "places",
        <textarea id="review-places" rows={3} className={inputClass} value={places} readOnly={!editable} onChange={(event) => setPlaces(event.target.value)} />,
        ["places"],
        nameHint,
      )}
      {row(
        "review-subjects",
        "Subjects",
        "subjects",
        <textarea id="review-subjects" rows={3} className={inputClass} value={subjects} readOnly={!editable} onChange={(event) => setSubjects(event.target.value)} />,
        ["subjects"],
        nameHint,
      )}

      <div role="alert" className="mt-6 text-sm text-oxblood-text">
        {otherErrors.map((text) => (
          <p key={text}>{text}</p>
        ))}
        {message !== null && otherErrors.length === 0 && Object.keys(errors).length === 0 ? <p>{message}</p> : null}
        {signedOut ? (
          <p>
            <Link href="/admin/login" className="underline">
              Sign in again
            </Link>
          </p>
        ) : null}
      </div>

      <div className="sticky bottom-0 mt-8 flex flex-wrap items-center gap-3 border-t border-line bg-ink py-4">
        {status === "needs_review" ? (
          <>
            <button type="button" disabled={pending} title="Accept (Enter)" className={buttonClass} onClick={() => run("accept")}>
              Accept
            </button>
            <button type="button" disabled={pending} title="Edit (E)" className={buttonClass} onClick={() => run("edit")}>
              Save edit
            </button>
          </>
        ) : null}
        {status === "needs_review" || status === "published" ? (
          <button type="button" disabled={pending} title="Reject (X)" className={buttonClass} onClick={() => run("reject")}>
            Reject
          </button>
        ) : null}
        {status === "rejected" ? (
          <button type="button" disabled={pending} title="Reopen" className={buttonClass} onClick={() => run("reopen")}>
            Reopen
          </button>
        ) : null}
        <span className="ml-auto text-xs text-paper-dim">{position}</span>
        <span aria-hidden="true" title="Keyboard shortcuts (?)" className="font-mono text-xs text-paper-dim">
          ?
        </span>
      </div>
    </div>
  );
}
