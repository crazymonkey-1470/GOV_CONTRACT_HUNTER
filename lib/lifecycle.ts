import { differenceInCalendarDays, format } from "date-fns";

import {
  type DeadlineInfo,
  deadlineInstant,
  easternCalendarDay,
  easternDay,
  formatDeadline,
  getDeadlineInfo,
  startInstant,
} from "@/lib/format";
import type { Opportunity } from "@/lib/types";

/** An opportunity with no deadline counts as closed once it has been listed this long. */
export const STALE_AFTER_DAYS = 30;

/** Status values an agent may set that mean the opportunity is over. */
const CLOSED_STATUSES = new Set([
  "expired",
  "closed",
  "cancelled",
  "canceled",
  "awarded",
  "archived",
]);

export interface Lifecycle {
  closed: boolean;
  /** Why it counts as closed, shown on the card in the Closed tab. */
  reason: string | null;
  deadline: DeadlineInfo;
}

/**
 * Open or closed? Closed when the deadline has passed, an agent marked it over,
 * or it never had a deadline and has been listed for more than STALE_AFTER_DAYS.
 */
export function lifecycleOf(o: Opportunity, now: Date): Lifecycle {
  const deadline = getDeadlineInfo(o.response_deadline, now);
  if (deadline.status === "expired") {
    return { closed: true, reason: `Closed ${formatDeadline(o.response_deadline)}`, deadline };
  }

  const status = (o.status ?? "").trim().toLowerCase();
  if (CLOSED_STATUSES.has(status)) {
    return { closed: true, reason: `Marked ${status}`, deadline };
  }
  if (/^\s*\[auto-expired\]/i.test(o.summary ?? "")) {
    return { closed: true, reason: "Marked expired by an agent", deadline };
  }

  if (deadline.status === "none") {
    // Count Eastern calendar days so the server (UTC) and the browser agree.
    const listed = easternCalendarDay(o.posted_date) ?? easternCalendarDay(o.created_at);
    if (listed && differenceInCalendarDays(easternDay(now), listed) > STALE_AFTER_DAYS) {
      return {
        closed: true,
        reason: `No deadline, listed since ${format(listed, "MMM d")}`,
        deadline,
      };
    }
  }

  return { closed: false, reason: null, deadline };
}

/**
 * Share of the response window already used (0–1), from posting to the deadline.
 * Date-only values mean midnight to midnight Eastern, matching getDeadlineInfo.
 */
export function windowUsed(o: Opportunity, now: Date): number | null {
  const end = deadlineInstant(o.response_deadline);
  const start = startInstant(o.posted_date) ?? startInstant(o.created_at);
  if (end === null || start === null) return null;
  const total = end - start;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / total));
}
