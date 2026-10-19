"use client";

import { ExternalLink, Mail, Target } from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { emailHref } from "@/lib/contact";
import { deadlineToneClass } from "@/lib/contracts";
import { formatDeadline } from "@/lib/format";
import { type Lifecycle, lifecycleOf } from "@/lib/lifecycle";
import { codePriority } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

/**
 * Deadline date + countdown, or why the opportunity expired. Stacked in the
 * Deadline column; inline under the title on phones.
 */
function DeadlineCell({
  o,
  life,
  stacked = false,
}: {
  o: Opportunity;
  life: Lifecycle;
  stacked?: boolean;
}) {
  if (life.closed) {
    return (
      <span className="font-medium text-destructive" suppressHydrationWarning>
        {life.reason}
      </span>
    );
  }
  if (life.deadline.status === "none") {
    return <span className="text-muted-foreground">No deadline</span>;
  }
  const tone = cn("whitespace-nowrap font-medium", deadlineToneClass(life.deadline.status));
  if (stacked) {
    return (
      <span suppressHydrationWarning>
        <span className="block whitespace-nowrap text-foreground">
          {formatDeadline(o.response_deadline)}
        </span>
        <span className={cn("block", tone)}>{life.deadline.label}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-x-2" suppressHydrationWarning>
      <span className="text-foreground">{formatDeadline(o.response_deadline)}</span>
      <span className={tone}>{life.deadline.label}</span>
    </span>
  );
}

export function ContractTable({
  items,
  now,
  onOpen,
}: {
  items: Opportunity[];
  now: number;
  onOpen: (id: string) => void;
}) {
  const reference = new Date(now);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3">Match</th>
            <th className="px-2 py-3">Opportunity</th>
            <th className="hidden px-2 py-3 lg:table-cell">Set-aside</th>
            <th className="hidden px-2 py-3 sm:table-cell">Deadline</th>
            <th className="px-4 py-3 text-right">Apply</th>
          </tr>
        </thead>
        <tbody>
          {items.map((o) => {
            const life = lifecycleOf(o, reference);
            const email = emailHref(o, "question");
            return (
              <tr
                key={o.id}
                onClick={() => onOpen(o.id)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
              >
                <td className="whitespace-nowrap px-4 py-3 align-top">
                  <MatchBadge score={o.relevance_score} />
                </td>
                <td className="px-2 py-3 [overflow-wrap:anywhere]">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(o.id);
                    }}
                    className="flex items-start gap-1.5 rounded-sm text-left font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {codePriority(o) ? (
                      <Target
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary"
                        aria-label="Target LIMS-consulting classification code"
                      />
                    ) : null}
                    <span>{o.title}</span>
                  </button>
                  {o.agency || o.notice_id ? (
                    <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {o.agency ? <span>{o.agency}</span> : null}
                      {o.notice_id ? <span className="font-mono">{o.notice_id}</span> : null}
                    </div>
                  ) : null}
                  {/* Phones hide the Deadline column, so show it here. */}
                  <div className="mt-1 text-xs sm:hidden">
                    <DeadlineCell o={o} life={life} />
                  </div>
                </td>
                <td className="hidden px-2 py-3 align-top lg:table-cell">
                  {o.set_aside ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="hidden px-2 py-3 align-top sm:table-cell">
                  <DeadlineCell o={o} life={life} stacked />
                </td>
                <td className="px-4 py-3 text-right align-top">
                  <div className="inline-flex items-center gap-3">
                    {email ? (
                      <a
                        href={email}
                        onClick={stop}
                        aria-label="Email CO"
                        title="Email CO"
                        className="rounded-sm text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Mail className="h-4 w-4" />
                      </a>
                    ) : null}
                    {o.sam_link ? (
                      <a
                        href={o.sam_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={stop}
                        className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        Apply
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
