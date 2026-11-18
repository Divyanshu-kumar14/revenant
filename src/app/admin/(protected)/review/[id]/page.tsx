import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReviewForm } from "@/components/review/review-form";
import type { ReviewFormValues } from "@/components/review/types";
import { resolveDataDir } from "@/data-dir";
import { getItem, getLatestExtraction, getRecord, listItemEntities, listNeedsReviewIds } from "@/db/queries";
import { serverDb } from "@/db/server";
import { deriveProposal, type Proposal } from "@/extract/extract-item";
import { submitReview } from "./actions";

// The layout's flag does not cover this page's own `await params`; Next flags it without this
// (same as login/page.tsx).
export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Review ${id}`, robots: { index: false, follow: false } };
}

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Request time only: deriveProposal reads the clock (normalizeDate's upper bound), which
  // Next refuses during prerender. Same reason as requireAdminPage.
  await connection();
  const db = serverDb(resolveDataDir());
  const item = getItem(db, id);
  if (!item) notFound();

  const record = getRecord(db, id);
  const latest = getLatestExtraction(db, id);
  let proposal: Proposal | null = null;
  let unreadable = false;
  if (latest) {
    try {
      proposal = deriveProposal(latest.rawJson);
    } catch {
      unreadable = true;
    }
  }

  let initial: ReviewFormValues;
  if (record) {
    const links = listItemEntities(db, id);
    const names = (type: string) => links.filter((link) => link.type === type).map((link) => link.name);
    initial = {
      title: record.title ?? "",
      description: record.description ?? "",
      transcription: record.transcription ?? "",
      dateDisplay: record.date_display ?? "",
      people: names("person"),
      places: names("place"),
      subjects: names("subject"),
    };
  } else if (proposal) {
    initial = {
      title: proposal.title ?? "",
      description: proposal.description ?? "",
      transcription: proposal.transcription ?? "",
      dateDisplay: proposal.date.display ?? "",
      people: proposal.people.map((entity) => entity.name),
      places: proposal.places.map((entity) => entity.name),
      subjects: proposal.subjects.map((entity) => entity.name),
    };
  } else {
    initial = { title: "", description: "", transcription: "", dateDisplay: "", people: [], places: [], subjects: [] };
  }

  const queue = listNeedsReviewIds(db);
  const index = queue.indexOf(id);
  const position =
    index >= 0 ? `Item ${index + 1} of ${queue.length} in needs_review` : `This item is ${item.status.replace("_", " ")}.`;

  const heading = initial.title !== "" ? initial.title : "Untitled photograph";

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-baseline gap-3 px-6 py-5">
          <Link href="/" className="font-display text-xl tracking-tight text-paper hover:text-lamp">
            Revenant
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">admin</span>
          <form method="post" action="/api/admin/logout" className="ml-auto">
            <button
              type="submit"
              className="cursor-pointer border border-lamp/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-lamp hover:border-lamp focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lamp"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <h1 className="font-display text-3xl leading-[1.1] tracking-tight text-paper">{heading}</h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">{item.file_name}</p>

        {item.error !== null && proposal === null ? (
          <p role="alert" className="mt-4 border border-line bg-ink-raised px-3 py-2 text-sm text-oxblood-text">
            Extraction failed ({item.error}). Fill in the fields by hand.
          </p>
        ) : null}
        {unreadable ? (
          <p role="alert" className="mt-4 border border-line bg-ink-raised px-3 py-2 text-sm text-oxblood-text">
            The stored extraction could not be read. Fill in the fields by hand.
          </p>
        ) : null}

        <div className="mt-8 grid gap-8 lg:grid-cols-[55fr_45fr]">
          <div>
            {/* A plain img: the source is an authenticated route, not something next/image should optimise. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/admin/image/${id}`}
              alt={initial.title !== "" ? initial.title : "Photograph under review"}
              className="h-auto w-full border border-line"
            />
          </div>
          <ReviewForm
            itemId={id}
            status={item.status}
            initial={initial}
            confidence={proposal?.confidence ?? {}}
            dateAmbiguous={proposal?.date.ambiguous ?? false}
            position={position}
            submit={submitReview}
          />
        </div>
      </main>
    </div>
  );
}
