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
  /** Human label, e.g. "12 days left", "5h left", "Due today", "Closed", "No deadline". */
  label: string;
  status: DeadlineStatus;
  /** Whole calendar days until the deadline (negative if past), or null. */
  days: number | null;
}

/**
 * Agents often send date-only deadlines, which are stored as midnight UTC.
 * Those mean "by the end of that day", not "8 PM the evening before" in US time.
 */
function isDateOnly(value: string, date: Date): boolean {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return true;
  return (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

/**
 * Deadlines are shown and counted in Eastern Time, so the server render and the
 * browser always agree (and match how most US notices state their deadlines).
 */
export const DISPLAY_TIME_ZONE = "America/New_York";

/** The calendar day of a date-only deadline, as local midnight. */
function calendarDay(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The Eastern-Time calendar day containing an instant, as local midnight. */
function easternDay(date: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .split("-")
    .map(Number);
  return new Date(y, m - 1, d);
}

/** Compute "X days left" style info for a deadline, honoring its time of day. */
export function getDeadlineInfo(
  value: string | null | undefined,
  now: Date = new Date(),
): DeadlineInfo {
  const date = toDate(value);
  if (!value || !date) return { label: "No deadline", status: "none", days: null };
  const today = easternDay(now);

  if (isDateOnly(value, date)) {
    const days = differenceInCalendarDays(calendarDay(date), today);
    if (days < 0) return { label: "Closed", status: "expired", days };
    if (days === 0) return { label: "Due today", status: "soon", days };
    if (days === 1) return { label: "1 day left", status: "soon", days };
    return { label: `${days} days left`, status: days <= 7 ? "soon" : "ok", days };
  }

  const msLeft = date.getTime() - now.getTime();
  const days = differenceInCalendarDays(easternDay(date), today);
  if (msLeft < 0) return { label: "Closed", status: "expired", days: Math.min(days, 0) };
  if (msLeft < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(msLeft / (60 * 60 * 1000));
    return { label: hours < 1 ? "Under 1h left" : `${hours}h left`, status: "soon", days };
  }
  if (days === 1) return { label: "1 day left", status: "soon", days };
  return { label: `${days} days left`, status: days <= 7 ? "soon" : "ok", days };
}

/**
 * Deadline text in Eastern Time, like "Thu, Oct 30, 2:00 PM EDT", or just
 * "Thu, Oct 30" for date-only deadlines. Em dash when unavailable.
 */
export function formatDeadline(
  value: string | null | undefined,
  options: { year?: boolean } = {},
): string {
  const date = toDate(value);
  if (!value || !date) return "—";
  const withYear = options.year ?? false;
  if (isDateOnly(value, date)) {
    return format(calendarDay(date), withYear ? "EEE, MMM d, yyyy" : "EEE, MMM d");
  }
  return date.toLocaleString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: withYear ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
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
