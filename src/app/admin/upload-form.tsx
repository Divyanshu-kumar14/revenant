"use client";

import { useRef, useState, type DragEvent } from "react";

type RowState = "uploading" | "queued" | "duplicate" | "error";

interface Row {
  key: number;
  name: string;
  state: RowState;
  message: string;
}

const MESSAGES: Record<Exclude<RowState, "error">, string> = {
  uploading: "Uploading…",
  queued: "Queued for extraction",
  duplicate: "Already in the archive",
};

const SIGN_IN = "Sign in to continue.";
const NO_RESPONSE = "The upload did not reach the server. Try again.";
const UNREADABLE = "The server sent a response this page could not read. Try again.";

type IngestBody =
  | { status: "queued" | "duplicate"; itemId: string; sha256: string }
  | { status: "error"; error: { code: string; message: string } };

/** POST one file and turn the route's answer into what the row should say. */
async function upload(file: File): Promise<Pick<Row, "state" | "message">> {
  const body = new FormData();
  body.append("file", file);
  let response: Response;
  try {
    response = await fetch("/api/admin/ingest", { method: "POST", body });
  } catch {
    return { state: "error", message: NO_RESPONSE };
  }
  if (response.status === 401) return { state: "error", message: SIGN_IN };
  let json: IngestBody;
  try {
    json = (await response.json()) as IngestBody;
  } catch {
    return { state: "error", message: UNREADABLE };
  }
  if (response.ok && (json.status === "queued" || json.status === "duplicate")) {
    return { state: json.status, message: MESSAGES[json.status] };
  }
  if (json.status === "error" && typeof json.error?.message === "string") {
    return { state: "error", message: json.error.message };
  }
  return { state: "error", message: UNREADABLE };
}

export function UploadForm() {
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextKey = useRef(0);

  function start(files: FileList | null) {
    if (!files || files.length === 0) return;
    const batch = Array.from(files, (file) => ({ file, key: nextKey.current++ }));
    setRows((current) => [
      ...current,
      ...batch.map(({ file, key }) => ({
        key,
        name: file.name,
        state: "uploading" as const,
        message: MESSAGES.uploading,
      })),
    ]);
    for (const { file, key } of batch) {
      void upload(file).then((result) =>
        setRows((current) =>
          current.map((row) => (row.key === key ? { ...row, ...result } : row)),
        ),
      );
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    start(event.dataTransfer.files);
  }

  return (
    <div className="mt-10">
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`border border-dashed px-6 py-12 text-center ${
          dragging ? "border-lamp bg-ink-raised" : "border-line"
        }`}
      >
        <p className="font-display text-xl text-paper">
          Drop photographs here
        </p>
        <p className="mt-2 text-sm text-paper-dim">or</p>
        <label className="mt-3 inline-block cursor-pointer border border-lamp/40 px-4 py-2 font-mono text-xs uppercase tracking-[0.14em] text-lamp focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp hover:border-lamp">
          Choose files
          <input
            type="file"
            name="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              start(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
        </label>
      </div>

      <section aria-labelledby="upload-results" className="mt-10">
        <h2
          id="upload-results"
          className="font-mono text-[11px] uppercase tracking-[0.18em] text-paper-dim"
        >
          Uploads
        </h2>
        <div aria-live="polite" className="mt-3">
          {rows.length === 0 ? (
            <p className="text-sm text-paper-dim">No files uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-line border border-line">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-col gap-1 bg-ink-raised px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
                >
                  <span className="break-all font-mono text-xs text-paper">
                    {row.name}
                  </span>
                  <span
                    className={`text-sm ${
                      row.state === "error" ? "text-oxblood-text" : "text-paper-dim"
                    }`}
                  >
                    {row.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
