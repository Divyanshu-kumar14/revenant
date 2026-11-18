import type { Metadata } from "next";
import Link from "next/link";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = {
  title: "Upload photographs",
  robots: { index: false, follow: false },
};

export default function AdminUploadPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-baseline gap-3 px-6 py-5">
          <Link href="/" className="font-display text-xl tracking-tight text-paper hover:text-lamp">
            Revenant
          </Link>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim">
            admin
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <h1 className="font-display text-4xl leading-[1.05] tracking-tight text-paper">
          Upload photographs
        </h1>
        <p className="mt-5 max-w-2xl leading-relaxed text-paper-dim">
          Add photographs from a phone or scanner. Each file is checked and
          queued for extraction. Nothing is published until a person reviews it.
        </p>
        <UploadForm />
      </main>
    </div>
  );
}
