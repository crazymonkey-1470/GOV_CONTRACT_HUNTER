import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

/**
 * Format a contract value as USD currency.
 * Returns "Not Specified" for empty, non-numeric, or non-positive values.
 */
export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "Not Specified";

  const num =
    typeof value === "number"
      ? value
      : Number(String(value).replace(/[^0-9.-]+/g, ""));

  if (!Number.isFinite(num) || num <= 0) return "Not Specified";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(num);
}

/** Safely parse a date string (ISO or yyyy-mm-dd) into a Date, or null. */
function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

/** Format a date as e.g. "Mar 5, 2026", or an em dash when unavailable. */
export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, "MMM d, yyyy") : "—";
}

export type DeadlineStatus = "ok" | "soon" | "expired" | "none";

export interface DeadlineInfo {
  /** Human label, e.g. "12 days left", "Due today", "Expired", "No deadline". */
  label: string;
  status: DeadlineStatus;
  /** Whole calendar days until the deadline (negative if past), or null. */
  days: number | null;
}

/** Compute "X days left" style info for a response deadline. */
export function getDeadlineInfo(
  value: string | null | undefined,
  now: Date = new Date(),
): DeadlineInfo {
  const date = toDate(value);
  if (!date) return { label: "No deadline", status: "none", days: null };

  const days = differenceInCalendarDays(date, now);

  if (days < 0) return { label: "Expired", status: "expired", days };
  if (days === 0) return { label: "Due today", status: "soon", days };
  if (days === 1) return { label: "1 day left", status: "soon", days };

  return { label: `${days} days left`, status: days <= 7 ? "soon" : "ok", days };
}

/**
 * Normalize a value that may be a real array, a JSON-encoded array string,
 * or a comma-separated string into a clean string array.
 */
export function toStringArray(
  value: string[] | string | null | undefined,
): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);

  const raw = String(value).trim();
  if (!raw) return [];

  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      // Not valid JSON — fall through to comma-splitting.
    }
  }

  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
