import { type DeadlineStatus, toStringArray } from "@/lib/format";
import type { Opportunity } from "@/lib/types";

/** Numeric relevance score, tolerating values that arrive as strings. */
export function scoreOf(opportunity: Opportunity): number {
  const n = Number(opportunity.relevance_score);
  return Number.isFinite(n) ? n : 0;
}

/** Keywords for display, with the agent's internal "Source:…" tags removed. */
export function visibleKeywords(opportunity: Opportunity, limit = 6): string[] {
  return toStringArray(opportunity.keywords)
    .filter((keyword) => !/^source\s*:/i.test(keyword))
    .slice(0, limit);
}

export function naicsList(opportunity: Opportunity): string[] {
  return toStringArray(opportunity.naics_codes);
}

export function requirementsList(opportunity: Opportunity): string[] {
  return toStringArray(opportunity.requirements);
}

/** Text color for a deadline urgency status. */
export function deadlineToneClass(status: DeadlineStatus): string {
  switch (status) {
    case "expired":
      return "text-destructive";
    case "soon":
      return "text-amber-600";
    case "ok":
      return "text-emerald-600";
    default:
      return "text-muted-foreground";
  }
}
