"use client";

import { Bookmark, CalendarClock, DollarSign, ExternalLink } from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSaved } from "@/components/saved-provider";
import { deadlineToneClass, naicsList } from "@/lib/contracts";
import { formatCurrency, getDeadlineInfo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

export function ContractCard({
  opportunity,
  now,
  onOpen,
}: {
  opportunity: Opportunity;
  now: number;
  onOpen: () => void;
}) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(opportunity.id);

  const deadline = getDeadlineInfo(opportunity.response_deadline, new Date(now));
  const value = formatCurrency(opportunity.value);
  const hasValue = value !== "Not Specified";
  const naics = naicsList(opportunity)[0];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group flex cursor-pointer flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-2 font-semibold leading-snug text-foreground">
            {opportunity.title}
          </h3>
          {opportunity.agency ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {opportunity.agency}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle(opportunity.id);
          }}
          aria-label={saved ? "Remove from saved" : "Save opportunity"}
          aria-pressed={saved}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Bookmark
            className={cn("h-4 w-4", saved && "fill-primary text-primary")}
          />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MatchBadge score={opportunity.relevance_score} />
        {opportunity.set_aside ? (
          <Badge variant="secondary">{opportunity.set_aside}</Badge>
        ) : null}
        {opportunity.notice_type ? (
          <Badge variant="outline">{opportunity.notice_type}</Badge>
        ) : null}
        {naics ? (
          <Badge variant="outline" className="font-mono text-[11px]">
            NAICS {naics}
          </Badge>
        ) : null}
      </div>

      {opportunity.summary ? (
        <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-foreground/75">
          {opportunity.summary}
        </p>
      ) : null}

      <div className="mt-3 flex items-end justify-between gap-3 pt-1">
        <div className="flex min-w-0 flex-col gap-1 text-sm">
          {hasValue ? (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5 shrink-0" />
              {value}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-medium",
              deadlineToneClass(deadline.status),
            )}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            {deadline.label}
          </span>
        </div>

        {opportunity.sam_link ? (
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <a
              href={opportunity.sam_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            >
              View &amp; Apply
              <ExternalLink />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
