import { cn } from "@/lib/utils";

/** Color tone for a 0–100 relevance/match score: green ≥85, amber 75–84, yellow 65–74. */
export function matchTone(score: number) {
  const value = Math.round(score);
  if (value >= 85) return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (value >= 75) return "bg-amber-50 text-amber-700 ring-amber-600/20";
  return "bg-yellow-50 text-yellow-700 ring-yellow-600/20";
}

/** Compact "88% match" pill. */
export function MatchBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const value = Math.round(score);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset",
        matchTone(score),
        className,
      )}
      title={`Relevance score ${value} / 100`}
    >
      {value}% match
    </span>
  );
}
