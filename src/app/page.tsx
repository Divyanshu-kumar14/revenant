const REPO = "https://github.com/Divyanshu-kumar14/revenant";

const steps = [
  {
    label: "Ingest",
    body: "Photograph the front and back. Every file is hashed, normalised and queued; the same bytes never become two records.",
    state: "scaffolded",
  },
  {
    label: "Extract",
    body: "A vision model transcribes the handwriting and proposes a title, a date range, people, places and per-field confidence.",
    state: "gate pending",
  },
  {
    label: "Review",
    body: "The volunteer accepts, edits or rejects every field with the keyboard. Nothing is published unreviewed.",
    state: "next",
  },
  {
    label: "Publish",
    body: "Accepted records become searchable, mappable and citable, with the model, timestamp and source file attached.",
    state: "next",
  },
] as const;

export default function Home() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl tracking-tight text-paper">
              Revenant
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
              archive at night
            </span>
          </div>
          <a
            href={REPO}
            className="font-mono text-xs text-paper-dim underline decoration-line underline-offset-4 hover:text-lamp"
          >
            source
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-oxblood">
          Kiroween 2026 · Resurrection
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-4xl leading-[1.05] tracking-tight text-paper sm:text-6xl">
          Every photograph deserves a name.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-paper-dim">
          Small historical societies hold boxes of photographs they cannot
          catalogue: no cataloguer, no vendor, no metadata training. Revenant
          turns a phone snapshot of an item into a reviewed, searchable,
          citable record — and keeps the uncertainty visible the whole way.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 border border-lamp/40 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-lamp">
            <span aria-hidden className="size-1.5 rounded-full bg-lamp" />
            Build in progress
          </span>
          <span className="font-mono text-[11px] tracking-wide text-paper-dim">
            The archive is not live yet. What is written down is what exists.
          </span>
        </div>

        <section aria-labelledby="scenario" className="mt-16">
          <h2
            id="scenario"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim"
          >
            The scenario
          </h2>
          <p className="mt-3 max-w-3xl font-display text-2xl leading-snug text-paper">
            A county historical society. 8,000 photographs in archival boxes,
            300 catalogued. A retired teacher volunteers two days a week and
            can scan — but she does not know Dublin Core, date normalisation or
            name authority files.
          </p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-paper-dim">
            The pain arrives when a family visits with a 1940s photograph and
            asks who the people are. The answer is in the box, not in the
            catalogue.
          </p>
        </section>

        <section aria-labelledby="flow" className="mt-16">
          <h2
            id="flow"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim"
          >
            The flow
          </h2>
          <ol className="mt-4 grid gap-px overflow-hidden border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.label} className="bg-ink-raised p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-lg text-paper">
                    {step.label}
                  </h3>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-paper-dim">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-paper-dim">
                  {step.body}
                </p>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-lamp/70">
                  {step.state}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="honesty" className="mt-16 border-l-2 border-oxblood pl-5">
          <h2
            id="honesty"
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim"
          >
            The rule
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-paper-dim">
            Extraction proposes; a person decides. Confidence is shown per
            field, low confidence is never hidden, and every accuracy number in
            this repository comes from a recorded evaluation run — never from a
            demo that happened to work once.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-6 font-mono text-[11px] text-paper-dim sm:flex-row sm:items-center sm:justify-between">
          <p>MIT licensed · built in public with Kiro</p>
          <div className="flex gap-4">
            <a
              href={`${REPO}/blob/main/docs/specs/revenant.md`}
              className="hover:text-lamp"
            >
              spec
            </a>
            <a
              href={`${REPO}/blob/main/docs/superpowers/plans/2026-11-18-revenant.md`}
              className="hover:text-lamp"
            >
              plan
            </a>
            <a href={`${REPO}/tree/main/.kiro`} className="hover:text-lamp">
              .kiro
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
