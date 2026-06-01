/**
 * A single government contract opportunity.
 *
 * Mirrors the `contract_opportunities` table in Supabase. A few columns are
 * intentionally typed loosely (e.g. `value`, `keywords`) because the upstream
 * AI agent may store them as numbers, strings, or arrays depending on the
 * source data. The helpers in `lib/format.ts` normalize these shapes for the UI.
 */
export interface Opportunity {
  id: string;
  notice_id: string | null;
  title: string;
  agency: string | null;
  value: number | string | null;
  posted_date: string | null;
  response_deadline: string | null;
  sam_link: string | null;
  relevance_score: number;
  summary: string | null;
  keywords: string[] | string | null;
  naics_codes: string[] | string | null;
  set_aside: string | null;
  customer_fit_notes: string | null;
  raw_data: unknown;
  status: string | null;
  created_at: string;
}

/** Minimum relevance score shown on the dashboard (per the product brief). */
export const MIN_RELEVANCE_SCORE = 65;

/**
 * A government contracting portal shown on the Helpful Links page.
 *
 * Mirrors the `sourcing_portals` table. `search_keywords` is typed loosely
 * because the agent may store an array or a delimited string; `toStringArray`
 * in `lib/format.ts` normalizes it for the UI.
 */
export interface SourcingPortal {
  id: string;
  name: string;
  state: string | null;
  portal_type: string | null;
  portal_url: string;
  notes: string | null;
  search_keywords: string[] | string | null;
  last_checked: string | null;
  is_active: boolean;
  created_at: string;
}
