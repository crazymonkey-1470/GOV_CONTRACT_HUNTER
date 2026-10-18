"use client";

import { ExternalLink, Mail, Target } from "lucide-react";

import { ClosedSticker, MatchSticker, pill } from "@/components/bubbly";
import { emailHref } from "@/lib/contact";
import { formatDeadline } from "@/lib/format";
import { lifecycleOf } from "@/lib/lifecycle";
import { codePriority } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

const th = "px-3 py-3 text-left font-display text-xs font-semibold text-ink/70";
const td = "px-3 py-3 align-top";
// Flat (not tilted) stickers, a touch smaller on phones so the title column gets the room.
const sticker = "rotate-0 px-2 text-xs sm:px-3 sm:text-sm";

/** Compact list view of opportunities inside a cream bubble. Rows open the detail drawer. */
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
    <div className="overflow-hidden rounded-bubble bg-cream text-ink shadow-bubble">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-cream-edge">
              <th scope="col" className={cn(th, "w-px whitespace-nowrap")}>
                Match
              </th>
              <th scope="col" className={th}>
                Opportunity
              </th>
              <th scope="col" className={cn(th, "hidden lg:table-cell")}>
                Set-aside
              </th>
              <th scope="col" className={cn(th, "hidden w-px whitespace-nowrap sm:table-cell")}>
                Responses close
              </th>
              <th scope="col" className={cn(th, "w-px whitespace-nowrap text-right")}>
                Contact
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((o) => {
              const life = lifecycleOf(o, reference);
              const status = life.deadline.status;
              const email = emailHref(o, "question");
              const target = codePriority(o) !== null;
              // The deadline date already sits on the line above, so an expired
              // deadline just says "Closed"; other closures explain why.
              const closedNote =
                status === "expired" ? life.deadline.label : (life.reason ?? life.deadline.label);
              const note = life.closed ? closedNote : status === "none" ? null : life.deadline.label;

              return (
                <tr
                  key={o.id}
                  onClick={() => onOpen(o.id)}
                  className="cursor-pointer border-b border-cream-edge last:border-0 hover:bg-cream-edge/50"
                >
                  <td className={cn(td, "w-px whitespace-nowrap pr-1.5 sm:pr-3")}>
                    {life.closed ? (
                      <ClosedSticker className={sticker} />
                    ) : (
                      <MatchSticker score={o.relevance_score} className={sticker} />
                    )}
                  </td>

                  <td className={cn(td, "min-w-0 [overflow-wrap:anywhere]")}>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(o.id);
                      }}
                      className="line-clamp-3 rounded-md text-left font-serif font-bold leading-snug text-ink hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30 sm:line-clamp-2"
                    >
                      {target ? (
                        <>
                          <span title="Target LIMS-consulting code">
                            <Target
                              aria-hidden="true"
                              className="-mt-0.5 mr-1 inline-block h-3.5 w-3.5 align-middle text-forest"
                            />
                          </span>
                          <span className="sr-only">Target LIMS-consulting code: </span>
                        </>
                      ) : null}
                      {o.title}
                    </button>
                    {o.agency || o.notice_id ? (
                      <p className="mt-1 line-clamp-1 text-xs text-ink/75">
                        {o.agency}
                        {o.notice_id ? (
                          <span className="tabular-nums">
                            {o.agency ? " · " : ""}
                            {o.notice_id}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                  </td>

                  <td className={cn(td, "hidden lg:table-cell")}>
                    {o.set_aside ? (
                      <span className="text-sm text-ink/80">{o.set_aside}</span>
                    ) : (
                      <span className="text-ink/70">—</span>
                    )}
                  </td>

                  <td className={cn(td, "hidden w-px whitespace-nowrap sm:table-cell")}>
                    <p
                      suppressHydrationWarning
                      className={cn(
                        "text-sm tabular-nums",
                        o.response_deadline ? "text-ink" : "text-ink/70",
                      )}
                    >
                      {o.response_deadline ? formatDeadline(o.response_deadline) : "No deadline"}
                    </p>
                    {note ? (
                      <p
                        suppressHydrationWarning
                        className={cn(
                          "mt-0.5 font-display text-xs font-semibold tabular-nums",
                          life.closed
                            ? "text-ink/70"
                            : status === "soon"
                              ? "text-ember-ink"
                              : status === "ok"
                                ? "text-forest"
                                : "text-ink/70",
                        )}
                      >
                        {note}
                      </p>
                    ) : null}
                  </td>

                  <td className={cn(td, "w-px whitespace-nowrap pl-1.5 text-right sm:pl-3")}>
                    {email || o.sam_link ? (
                      <div className="flex flex-col items-end gap-2 md:flex-row md:justify-end">
                        {email ? (
                          <a
                            href={email}
                            onClick={stop}
                            aria-label="Email CO"
                            title="Email CO"
                            className={cn(pill.base, pill.sun, pill.icon)}
                          >
                            <Mail aria-hidden="true" />
                          </a>
                        ) : null}
                        {o.sam_link ? (
                          <a
                            href={o.sam_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={stop}
                            aria-label="View & apply"
                            title="View & apply"
                            className={cn(pill.base, pill.outline, pill.icon)}
                          >
                            <ExternalLink aria-hidden="true" />
                          </a>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-ink/70">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No contact listed</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
