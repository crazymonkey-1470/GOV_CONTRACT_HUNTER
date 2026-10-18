import { toStringArray } from "@/lib/format";
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

export function interestedVendors(opportunity: Opportunity): string[] {
  return toStringArray(opportunity.interested_vendors);
}

/**
 * What's publicly known about competition: the incumbent, or how many vendors
 * are on the public interested-vendor / plan-holder list. Bids themselves stay
 * sealed until opening or award.
 */
export function competitionSummary(opportunity: Opportunity): string | null {
  if (opportunity.incumbent) return `Incumbent: ${opportunity.incumbent}`;
  const vendors = interestedVendors(opportunity).length;
  if (vendors) return `${vendors} interested ${vendors === 1 ? "vendor" : "vendors"}`;
  return null;
}
