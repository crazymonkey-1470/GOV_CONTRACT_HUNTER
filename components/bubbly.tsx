import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Pill button styles shared across the app. Combine with `pill.base`. */
export const pill = {
  base: "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-4 font-display text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  sun: "bg-sun text-ink shadow-sticker hover:bg-sun-soft focus-visible:ring-forest/30",
  forest: "bg-forest text-sun hover:bg-forest-deep focus-visible:ring-sun/60",
  outline:
    "border-2 border-forest/70 text-forest hover:bg-forest hover:text-sun focus-visible:ring-forest/30",
  ghost: "text-ink/70 hover:bg-cream-edge hover:text-ink focus-visible:ring-forest/30",
  icon: "w-10 px-0",
};

/** Tilted gold "92% match" sticker. Strong matches get the strongest gold. */
export function MatchSticker({ score, className }: { score: number; className?: string }) {
  const value = Math.round(score);
  return (
    <span
      title={`Relevance score ${value} out of 100`}
      className={cn(
        "inline-flex shrink-0 rotate-[3deg] items-center rounded-xl px-3 py-1 font-display text-sm font-bold text-ink shadow-sticker",
        value >= 85 ? "bg-sun" : value >= 75 ? "bg-sun-soft" : "bg-cream-edge",
        className,
      )}
    >
      {value}% match
    </span>
  );
}

/** Gray sticker for opportunities that are over. */
export function ClosedSticker({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rotate-[3deg] items-center rounded-xl bg-ink/10 px-3 py-1 font-display text-sm font-bold text-ink/75 shadow-sticker",
        className,
      )}
    >
      Closed
    </span>
  );
}

/** Outlined, slightly tilted stamp for the notice type ("Request for Proposal"). */
export function TypeStamp({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[65%] -rotate-[1.5deg] items-center truncate rounded-md border-2 border-ink/80 px-2 py-0.5 font-display text-[11px] font-semibold uppercase tracking-wider text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Vote-style bar showing how much of the response window is used up. */
export function TimeBar({
  used,
  tone,
  className,
}: {
  used: number | null;
  tone: "leaf" | "ember" | "muted";
  className?: string;
}) {
  const width = used === null ? 0 : Math.max(4, Math.round(used * 100));
  return (
    <div
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-cream-edge", className)}
      role="presentation"
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "leaf" && "bg-leaf",
          tone === "ember" && "bg-ember",
          tone === "muted" && "bg-ink/25",
        )}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** Centered section heading between two fading gold rules. */
export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="h-0.5 flex-1 rounded-full bg-gradient-to-r from-transparent to-sun/70" />
      <h1
        id={id}
        className="shrink-0 font-display text-lg font-bold uppercase tracking-[0.08em] text-sun sm:text-xl"
      >
        {children}
      </h1>
      <span className="h-0.5 flex-1 rounded-full bg-gradient-to-l from-transparent to-sun/70" />
    </div>
  );
}

/** The stacked gold wordmark. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block font-display font-bold uppercase leading-[0.88] tracking-tight text-sun [text-shadow:0_2px_0_rgba(0,0,0,0.25)]",
        className,
      )}
    >
      <span className="block">Contract</span>
      <span className="block">Hunter</span>
    </span>
  );
}
