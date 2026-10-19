"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Bookmark,
  Check,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Phone,
  Send,
} from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSaved } from "@/components/saved-provider";
import { emailHref, phoneHref } from "@/lib/contact";
import {
  deadlineToneClass,
  interestedVendors,
  naicsList,
  requirementsList,
  visibleKeywords,
} from "@/lib/contracts";
import { formatCurrency, formatDate, formatDeadline, getDeadlineInfo } from "@/lib/format";
import { type Lifecycle, lifecycleOf } from "@/lib/lifecycle";
import { TARGET_NAICS, TARGET_PSC, pscOf } from "@/lib/priority";
import { responseSteps } from "@/lib/process";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

/** Interested vendors shown as badges before collapsing into "+N more". */
const VENDOR_LIMIT = 12;

function Fact({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("mt-6", className)}>
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function DeadlineValue({ o, life }: { o: Opportunity; life: Lifecycle }) {
  if (life.closed) {
    return (
      <span className="font-medium text-destructive" suppressHydrationWarning>
        {life.deadline.status === "expired" || !o.response_deadline
          ? life.reason
          : `${formatDeadline(o.response_deadline, { year: true })} · ${life.reason}`}
      </span>
    );
  }
  if (life.deadline.status === "none") {
    return <span className="text-muted-foreground">No deadline listed yet</span>;
  }
  return (
    <span suppressHydrationWarning>
      <span className="font-medium">{formatDeadline(o.response_deadline, { year: true })}</span>
      <span className={cn("font-medium", deadlineToneClass(life.deadline.status))}>
        {" "}
        · {life.deadline.label}
      </span>
    </span>
  );
}

function ContactSection({ o }: { o: Opportunity }) {
  const ask = emailHref(o, "question");
  const pitch = emailHref(o, "interest");
  const tel = phoneHref(o.poc_phone);
  const name = o.poc_name?.trim();
  const email = o.poc_email?.trim();

  return (
    <Section title="Contracting officer">
      {name || email || tel ? (
        <div className="space-y-1 text-sm">
          {name ? <div className="text-foreground">{name}</div> : null}
          {email ? (
            <a
              href={`mailto:${email}`}
              className="inline-flex max-w-full items-center gap-1.5 break-all text-primary hover:underline"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              {email}
            </a>
          ) : null}
          {tel ? (
            <div>
              <a
                href={tel}
                className="inline-flex items-center gap-1.5 text-primary hover:underline"
              >
                <Phone className="h-3.5 w-3.5 shrink-0" />
                {o.poc_phone}
              </a>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No contact captured yet. The solicitation names the contracting officer.
        </p>
      )}

      {ask ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <a href={ask}>
              <MessageCircleQuestion />
              Ask a question
            </a>
          </Button>
          {pitch ? (
            <Button asChild size="sm" variant="outline">
              <a href={pitch}>
                <Send />
                Send capability statement
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function StepsSection({ o, reference }: { o: Opportunity; reference: Date }) {
  const steps = responseSteps(o, reference);

  return (
    <Section title="How to respond">
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={`${index}-${step.title}`} className="flex gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                step.passed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <p
                suppressHydrationWarning
                className={cn(
                  "break-words text-sm font-medium",
                  step.passed ? "text-muted-foreground line-through" : "text-foreground",
                )}
              >
                {step.title}
                {step.passed ? <span className="sr-only"> (passed)</span> : null}
              </p>
              {step.detail ? (
                <p className="mt-0.5 break-words text-sm text-foreground/70">{step.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function CompetitionSection({ o }: { o: Opportunity }) {
  const vendors = interestedVendors(o);
  const shown = vendors.slice(0, VENDOR_LIMIT);
  const hidden = vendors.slice(VENDOR_LIMIT);
  const incumbent = o.incumbent?.trim();
  const url = o.interested_vendors_url?.trim();

  return (
    <Section title="Competition">
      {incumbent || vendors.length || url ? (
        <div className="space-y-2.5 text-sm">
          {incumbent ? (
            <p className="break-words text-foreground/80">
              Incumbent: <span className="font-medium text-foreground">{incumbent}</span>
            </p>
          ) : null}
          {vendors.length ? (
            <div>
              <p className="text-foreground/80">
                {vendors.length} interested {vendors.length === 1 ? "vendor" : "vendors"}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {shown.map((vendor, index) => (
                  <Badge key={`${index}-${vendor}`} variant="outline" className="max-w-full">
                    <span className="truncate">{vendor}</span>
                  </Badge>
                ))}
                {hidden.length ? (
                  <Badge variant="secondary" title={hidden.join(", ")}>
                    +{hidden.length} more
                  </Badge>
                ) : null}
              </div>
            </div>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
            >
              See the public vendor list
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Bids stay sealed until opening or award, so this is what&apos;s public.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No public competitor info yet.</p>
      )}
    </Section>
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

  const o = opportunity ?? shown;
  const open = Boolean(opportunity);
  const reference = new Date(now);
  const life = o ? lifecycleOf(o, reference) : null;

  const value = o ? formatCurrency(o.value) : "Not Specified";
  const hasValue = value !== "Not Specified";
  const naics = o ? naicsList(o) : [];
  const psc = o ? pscOf(o) : null;
  const requirements = o ? requirementsList(o) : [];
  const keywords = o ? visibleKeywords(o, 10) : [];
  const saved = o ? isSaved(o.id) : false;
  const questions =
    o?.questions_deadline ? getDeadlineInfo(o.questions_deadline, reference) : null;
  const questionsPassed = questions?.status === "expired";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        {o && life ? (
          <>
            <SheetHeader className="space-y-3 border-b p-6 pr-12 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <MatchBadge score={o.relevance_score} />
                {o.notice_type ? <Badge variant="outline">{o.notice_type}</Badge> : null}
                {o.set_aside ? (
                  <Badge variant="secondary" className="max-w-full">
                    <span className="truncate">{o.set_aside}</span>
                  </Badge>
                ) : null}
              </div>
              <SheetTitle className="break-words text-xl leading-snug">{o.title}</SheetTitle>
              {o.agency || o.place_of_performance ? (
                <div className="space-y-1 text-sm text-muted-foreground">
                  {o.agency ? <p className="break-words">{o.agency}</p> : null}
                  {o.place_of_performance ? (
                    <p className="flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{o.place_of_performance}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
              <SheetDescription className="sr-only">
                Deadline, contact and response steps for this opportunity
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto p-6">
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Response deadline" className="col-span-2">
                  <DeadlineValue o={o} life={life} />
                </Fact>
                {questions && questions.status !== "none" ? (
                  <Fact label="Questions due" className="col-span-2">
                    <span
                      suppressHydrationWarning
                      className={cn(questionsPassed && "text-muted-foreground line-through")}
                    >
                      {formatDeadline(o.questions_deadline, { year: true })}
                    </span>
                    {questionsPassed ? (
                      <span className="text-muted-foreground"> · passed</span>
                    ) : null}
                  </Fact>
                ) : null}
                {o.notice_id ? (
                  <Fact label="Solicitation #">
                    <span className="break-all font-mono">{o.notice_id}</span>
                  </Fact>
                ) : null}
                {hasValue ? <Fact label="Est. value">{value}</Fact> : null}
                {naics.length ? (
                  <Fact label="NAICS">
                    <span className="font-mono">
                      {naics.map((code, index) => (
                        <span key={`${index}-${code}`}>
                          {index > 0 ? ", " : ""}
                          <span
                            className={cn(TARGET_NAICS.has(code) && "font-semibold text-primary")}
                            title={
                              TARGET_NAICS.has(code) ? "Target LIMS-consulting NAICS code" : undefined
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
                      className={cn("font-mono", TARGET_PSC.has(psc) && "font-semibold text-primary")}
                      title={
                        TARGET_PSC.has(psc) ? "Target LIMS-consulting product service code" : undefined
                      }
                    >
                      {psc}
                    </span>
                  </Fact>
                ) : null}
                {o.posted_date ? (
                  <Fact label="Posted">
                    <span suppressHydrationWarning>{formatDate(o.posted_date)}</span>
                  </Fact>
                ) : null}
              </dl>

              <ContactSection o={o} />
              <StepsSection o={o} reference={reference} />
              <CompetitionSection o={o} />

              {o.summary ? (
                <Section title="Description">
                  <p className="whitespace-pre-line break-words text-sm leading-relaxed text-foreground/80">
                    {o.summary}
                  </p>
                </Section>
              ) : null}

              {o.customer_fit_notes ? (
                <section className="mt-6 rounded-lg border bg-muted/40 p-3">
                  <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Why it fits
                  </h4>
                  <p className="mt-1.5 break-words text-sm leading-relaxed text-foreground/80">
                    {o.customer_fit_notes}
                  </p>
                </section>
              ) : null}

              {requirements.length ? (
                <Section title="Key requirements">
                  <ul className="space-y-1.5">
                    {requirements.map((requirement, index) => (
                      <li
                        key={`${index}-${requirement}`}
                        className="flex gap-2 text-sm text-foreground/80"
                      >
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        <span className="min-w-0 break-words">{requirement}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              ) : null}

              {keywords.length ? (
                <Section title="Keywords">
                  <div className="flex flex-wrap gap-1.5">
                    {keywords.map((keyword, index) => (
                      <Badge key={`${index}-${keyword}`} variant="outline" className="max-w-full">
                        <span className="truncate">{keyword}</span>
                      </Badge>
                    ))}
                  </div>
                </Section>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button
                type="button"
                variant="outline"
                onClick={() => toggle(o.id)}
                className="shrink-0"
              >
                <Bookmark className={cn("h-4 w-4", saved && "fill-primary text-primary")} />
                {saved ? "Saved" : "Save"}
              </Button>
              {o.sam_link ? (
                <Button asChild className="flex-1">
                  <a href={o.sam_link} target="_blank" rel="noopener noreferrer">
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
            <SheetDescription className="sr-only">
              Deadline, contact and response steps for this opportunity
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
