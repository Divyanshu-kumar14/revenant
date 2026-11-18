/** Below this a field is "low" (archive-conventions §3). Missing counts as low. */
export const LOW_CONFIDENCE = 0.7;

export function isLowConfidence(value: number | null | undefined): boolean {
  return value === null || value === undefined || value < LOW_CONFIDENCE;
}

/**
 * The model's self-reported confidence for one field. Low is carried by the word "low" and a
 * dotted underline, never by colour alone.
 */
export function ConfidenceBadge({ value, label = "model confidence" }: { value: number | null | undefined; label?: string }) {
  const low = isLowConfidence(value);
  const shown = value === null || value === undefined ? "unknown" : value.toFixed(2);
  return (
    <span
      className={`font-mono text-[11px] tracking-[0.08em] text-paper-dim ${
        low ? "border-b border-dotted border-lamp" : ""
      }`}
    >
      {label} {shown}
      {low ? " · low" : ""}
    </span>
  );
}
