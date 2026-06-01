import { cn } from "@/lib/utils";

/**
 * Large colored relevance-score badge.
 *   green  >= 85
 *   orange  75 - 84
 *   yellow  65 - 74
 */
export function RelevanceBadge({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const value = Math.round(score);

  const color =
    value >= 85
      ? "bg-green-100 text-green-800 ring-green-600/20"
      : value >= 75
        ? "bg-orange-100 text-orange-800 ring-orange-600/20"
        : "bg-yellow-100 text-yellow-800 ring-yellow-600/20";

  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg ring-1 ring-inset tabular-nums",
        color,
        className,
      )}
      title={`Relevance score: ${value} / 100`}
      aria-label={`Relevance score ${value} out of 100`}
    >
      <span className="text-xl font-bold leading-none">{value}</span>
      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wide opacity-70">
        score
      </span>
    </div>
  );
}
