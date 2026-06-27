"use client";

import { ExternalLink } from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { deadlineToneClass } from "@/lib/contracts";
import { getDeadlineInfo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

export function ContractTable({
  items,
  now,
  onOpen,
}: {
  items: Opportunity[];
  now: number;
  onOpen: (id: string) => void;
}) {
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
          {items.map((opportunity) => {
            const deadline = getDeadlineInfo(
              opportunity.response_deadline,
              new Date(now),
            );
            return (
              <tr
                key={opportunity.id}
                onClick={() => onOpen(opportunity.id)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-3 align-top">
                  <MatchBadge score={opportunity.relevance_score} />
                </td>
                <td className="px-2 py-3">
                  <div className="font-medium text-foreground">
                    {opportunity.title}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {opportunity.agency}
                    {opportunity.notice_id ? (
                      <span className="font-mono"> · {opportunity.notice_id}</span>
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-2 py-3 align-top lg:table-cell">
                  {opportunity.set_aside ?? (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="hidden px-2 py-3 align-top sm:table-cell">
                  <span
                    className={cn("font-medium", deadlineToneClass(deadline.status))}
                  >
                    {deadline.label}
                  </span>
                </td>
                <td className="px-4 py-3 text-right align-top">
                  {opportunity.sam_link ? (
                    <a
                      href={opportunity.sam_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      Apply
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
