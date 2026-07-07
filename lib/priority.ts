import { naicsList } from "@/lib/contracts";
import type { Opportunity } from "@/lib/types";

/**
 * Target classification codes for LIMS specialty consulting work.
 *
 * Mirrors the scraper's sweep configuration (scraper/config.py): the codes
 * agencies actually file LIMS consulting, integration, and support work under.
 * The dashboard uses these to badge, filter, and tie-break-sort opportunities.
 */
export const PRIMARY_NAICS = "541512"; // Computer Systems Design Services

export const TARGET_NAICS = new Set([
  "541512", // Computer Systems Design Services (primary)
  "541511", // Custom Computer Programming Services
  "541690", // Other Scientific and Technical Consulting Services
  "541611", // Admin/General Management Consulting Services
  "541519", // Other Computer Related Services
]);

export const TARGET_PSC = new Set([
  "DA01", // IT & Telecom – Business Application Support
  "DJ01", // IT & Telecom – Security and Compliance Support
  "DB02", // IT & Telecom – Compute Support
  "R425", // Professional Support – Engineering/Technical
  "R408", // Professional Support – Program Management
  "R499", // Professional Support – Other
]);

/**
 * Product Service Code of an opportunity, if the row carries one.
 * Scraper rows keep the full SAM payload under raw_data.sam.
 */
export function pscOf(opportunity: Opportunity): string | null {
  const raw = opportunity.raw_data;
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const sam = record.sam;
  const fromSam =
    sam && typeof sam === "object"
      ? (sam as Record<string, unknown>).classificationCode
      : undefined;
  const code = fromSam ?? record.classificationCode;
  return typeof code === "string" && code ? code : null;
}

export type CodePriority = "primary" | "target" | null;

/**
 * How strongly an opportunity's classification codes match the target list:
 * "primary" = carries 541512; "target" = any other target NAICS or PSC;
 * null = no code match (it qualified on LIMS text relevance alone).
 */
export function codePriority(opportunity: Opportunity): CodePriority {
  const naics = naicsList(opportunity);
  if (naics.includes(PRIMARY_NAICS)) return "primary";
  const psc = pscOf(opportunity);
  if (naics.some((code) => TARGET_NAICS.has(code)) || (psc && TARGET_PSC.has(psc))) {
    return "target";
  }
  return null;
}

/** Sort rank for tie-breaking: primary first, then target, then the rest. */
export function priorityRank(opportunity: Opportunity): number {
  const priority = codePriority(opportunity);
  return priority === "primary" ? 0 : priority === "target" ? 1 : 2;
}
