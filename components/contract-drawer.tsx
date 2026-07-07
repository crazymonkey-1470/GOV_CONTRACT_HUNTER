"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bookmark, Check, ExternalLink, Mail } from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSaved } from "@/components/saved-provider";
import {
  deadlineToneClass,
  naicsList,
  requirementsList,
  visibleKeywords,
} from "@/lib/contracts";
import { formatCurrency, formatDate, getDeadlineInfo } from "@/lib/format";
import { TARGET_NAICS, TARGET_PSC, pscOf } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">{children}</dd>
    </div>
  );
}

export function ContractDrawer({
  opportunity,
  now,
  onOpenChange,
}: {
  opportunity: Opportunity | null;
  now: number;
  onOpenChange: (open: boolean) => void;
}) {
  const { isSaved, toggle } = useSaved();
  // Keep the last opportunity during the close animation so content doesn't blank.
  const [shown, setShown] = useState<Opportunity | null>(opportunity);
  useEffect(() => {
    if (opportunity) setShown(opportunity);
  }, [opportunity]);

  const o = shown;
  const open = Boolean(opportunity);

  const deadline = o ? getDeadlineInfo(o.response_deadline, new Date(now)) : null;
  const value = o ? formatCurrency(o.value) : "Not Specified";
  const hasValue = value !== "Not Specified";
  const naics = o ? naicsList(o) : [];
  const psc = o ? pscOf(o) : null;
  const requirements = o ? requirementsList(o) : [];
  const keywords = o ? visibleKeywords(o, 10) : [];
  const saved = o ? isSaved(o.id) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {o ? (
          <>
            <SheetHeader className="space-y-3 border-b p-6 pr-12">
              <div className="flex flex-wrap items-center gap-2">
                <MatchBadge score={o.relevance_score} />
                {o.notice_type ? (
                  <Badge variant="outline">{o.notice_type}</Badge>
                ) : null}
                {o.set_aside ? (
                  <Badge variant="secondary">{o.set_aside}</Badge>
                ) : null}
              </div>
              <SheetTitle className="text-xl leading-snug">{o.title}</SheetTitle>
              {o.agency ? (
                <p className="text-sm text-muted-foreground">{o.agency}</p>
              ) : null}
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6">
              <dl className="grid grid-cols-2 gap-4">
                {o.notice_id ? (
                  <Fact label="Solicitation #">
                    <span className="font-mono">{o.notice_id}</span>
                  </Fact>
                ) : null}
                {naics.length ? (
                  <Fact label="NAICS">
                    <span className="font-mono">
                      {naics.map((code, index) => (
                        <span key={code}>
                          {index > 0 ? ", " : ""}
                          <span
                            className={cn(
                              TARGET_NAICS.has(code) && "font-semibold text-primary",
                            )}
                            title={
                              TARGET_NAICS.has(code)
                                ? "Target LIMS-consulting NAICS code"
                                : undefined
                            }
                          >
                            {code}
                          </span>
                        </span>
                      ))}
                    </span>
                  </Fact>
                ) : null}
                {psc ? (
                  <Fact label="PSC">
                    <span
                      className={cn(
                        "font-mono",
                        TARGET_PSC.has(psc) && "font-semibold text-primary",
                      )}
                      title={
                        TARGET_PSC.has(psc)
                          ? "Target LIMS-consulting product service code"
                          : undefined
                      }
                    >
                      {psc}
                    </span>
                  </Fact>
                ) : null}
                {hasValue ? <Fact label="Est. value">{value}</Fact> : null}
                {o.posted_date ? (
                  <Fact label="Posted">{formatDate(o.posted_date)}</Fact>
                ) : null}
                {deadline && deadline.status !== "none" ? (
                  <Fact label="Response deadline">
                    <span
                      className={cn(
                        "font-medium",
                        deadlineToneClass(deadline.status),
                      )}
                    >
                      {formatDate(o.response_deadline)} · {deadline.label}
                    </span>
                  </Fact>
                ) : null}
              </dl>

              {o.summary ? (
                <section className="mt-6">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Description
                  </h4>
                  <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-foreground/80">
                    {o.summary}
                  </p>
                </section>
              ) : null}

              {o.customer_fit_notes ? (
                <section className="mt-6 rounded-lg border bg-muted/40 p-3">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Why it fits
                  </h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-foreground/80">
                    {o.customer_fit_notes}
                  </p>
                </section>
              ) : null}

              {requirements.length ? (
                <section className="mt-6">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Key requirements
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {requirements.map((requirement) => (
                      <li
                        key={requirement}
                        className="flex gap-2 text-sm text-foreground/80"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span>{requirement}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {o.poc_name || o.poc_email ? (
                <section className="mt-6">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Contracting officer
                  </h4>
                  <div className="mt-1.5 text-sm">
                    {o.poc_name ? (
                      <div className="text-foreground">{o.poc_name}</div>
                    ) : null}
                    {o.poc_email ? (
                      <a
                        href={`mailto:${o.poc_email}`}
                        className="inline-flex items-center gap-1.5 text-primary hover:underline"
                      >
                        <Mail className="h-3.5 w-3.5" />
                        {o.poc_email}
                      </a>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {keywords.length ? (
                <section className="mt-6">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Keywords
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {keywords.map((keyword) => (
                      <Badge key={keyword} variant="outline">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t p-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => toggle(o.id)}
                className="shrink-0"
              >
                <Bookmark
                  className={cn("h-4 w-4", saved && "fill-primary text-primary")}
                />
                {saved ? "Saved" : "Save"}
              </Button>
              {o.sam_link ? (
                <Button asChild className="flex-1">
                  <a
                    href={o.sam_link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View &amp; Apply
                    <ExternalLink />
                  </a>
                </Button>
              ) : null}
            </div>
          </>
        ) : (
          <SheetHeader className="p-6">
            <SheetTitle className="sr-only">Opportunity details</SheetTitle>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
