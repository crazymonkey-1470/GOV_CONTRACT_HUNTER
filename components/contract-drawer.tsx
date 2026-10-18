"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  CalendarClock,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Info,
  ListChecks,
  MapPin,
  MessageCircleQuestion,
  Phone,
  Send,
  Sparkles,
  Tags,
  UserRound,
  Users,
} from "lucide-react";

import { ClosedSticker, MatchSticker, TimeBar, TypeStamp, pill } from "@/components/bubbly";
import { useSaved } from "@/components/saved-provider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { emailHref, phoneHref } from "@/lib/contact";
import {
  interestedVendors,
  naicsList,
  requirementsList,
  scoreOf,
  visibleKeywords,
} from "@/lib/contracts";
import { formatCurrency, formatDate, formatDeadline, getDeadlineInfo } from "@/lib/format";
import { type Lifecycle, lifecycleOf, windowUsed } from "@/lib/lifecycle";
import { TARGET_NAICS, TARGET_PSC, pscOf } from "@/lib/priority";
import { responseSteps } from "@/lib/process";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

/** Interested vendors shown as chips before collapsing into "+N more". */
const VENDOR_LIMIT = 12;

/** Static chip on cream (same as the card's fact chips). */
const chip =
  "inline-flex max-w-full items-center gap-1.5 rounded-full bg-cream-edge px-2.5 py-1 text-xs font-semibold text-ink/80";

/** Highlight for NAICS / PSC codes on the LIMS-consulting target list. */
const targetCode = "rounded-md bg-sun-soft px-1 font-bold text-ink";

function Section({
  icon: Icon,
  title,
  panel = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Sit the section in an inner panel on the cream sheet. */
  panel?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn(panel && "rounded-2xl bg-cream-edge/50 p-4")}>
      <h3 id={id} className="flex items-center gap-2 font-display text-base font-bold text-ink">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-forest" />
        {title}
      </h3>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function DeadlineSection({
  o,
  life,
  reference,
}: {
  o: Opportunity;
  life: Lifecycle;
  reference: Date;
}) {
  const soon = life.deadline.status === "soon";
  const hasDeadline = life.deadline.status !== "none";
  const questions = o.questions_deadline
    ? getDeadlineInfo(o.questions_deadline, reference)
    : null;
  const questionsPassed = questions?.status === "expired";
  const posted = formatDate(o.posted_date);

  return (
    <Section icon={CalendarClock} title="Deadline" panel>
      {life.closed ? (
        <>
          {/* A passed deadline's reason already names the date; other closures don't. */}
          {hasDeadline && life.deadline.status !== "expired" ? (
            <p className="text-sm text-ink/80" suppressHydrationWarning>
              Responses close{" "}
              <strong className="font-bold tabular-nums text-ink">
                {formatDeadline(o.response_deadline, { year: true })}
              </strong>
            </p>
          ) : null}
          <p className="text-sm text-ink/80" suppressHydrationWarning>
            {life.reason}
          </p>
          <TimeBar used={1} tone="muted" className="mt-2" />
        </>
      ) : hasDeadline ? (
        <>
          <p className="text-sm text-ink/80" suppressHydrationWarning>
            Responses close{" "}
            <strong className="font-bold tabular-nums text-ink">
              {formatDeadline(o.response_deadline, { year: true })}
            </strong>
          </p>
          <div className="mt-2 flex items-center gap-3">
            <TimeBar used={windowUsed(o, reference)} tone={soon ? "ember" : "leaf"} />
            <span
              suppressHydrationWarning
              className={cn(
                "shrink-0 font-display text-sm font-semibold tabular-nums",
                // text-leaf measures 4.57:1 on the inner panel (AA for this size).
                soon ? "text-ember-ink" : "text-leaf",
              )}
            >
              {life.deadline.label}
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink/80">No deadline listed yet</p>
      )}

      {(questions && questions.status !== "none") || posted !== "—" ? (
        <div className="mt-3 space-y-1 text-sm">
          {questions && questions.status !== "none" ? (
            <p
              suppressHydrationWarning
              className={cn(
                "tabular-nums",
                questionsPassed ? "text-ink/70 line-through" : "text-ink/80",
              )}
            >
              Questions due {formatDeadline(o.questions_deadline)}
              {questionsPassed ? " · passed" : null}
            </p>
          ) : null}
          {posted !== "—" ? (
            <p className="tabular-nums text-ink/75" suppressHydrationWarning>
              Posted {posted}
            </p>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function ContactSection({ o }: { o: Opportunity }) {
  const ask = emailHref(o, "question");
  const pitch = emailHref(o, "interest");
  const tel = phoneHref(o.poc_phone);
  const name = o.poc_name?.trim();
  const email = o.poc_email?.trim();

  return (
    <Section icon={UserRound} title="Contact" panel>
      {name || email ? (
        <div className="min-w-0">
          {name ? <p className="break-words font-semibold text-ink">{name}</p> : null}
          {email ? <p className="break-all text-sm text-ink/75">{email}</p> : null}
        </div>
      ) : null}

      {ask || tel ? (
        <div className={cn("flex flex-wrap gap-2", (name || email) && "mt-3")}>
          {ask ? (
            <a href={ask} className={cn(pill.base, pill.sun)}>
              <MessageCircleQuestion aria-hidden="true" />
              Ask a question
            </a>
          ) : null}
          {pitch ? (
            <a href={pitch} className={cn(pill.base, pill.forest, "focus-visible:ring-forest/30")}>
              <Send aria-hidden="true" />
              Send capability statement
            </a>
          ) : null}
          {tel ? (
            <a
              href={tel}
              aria-label={`Call ${name || "the contracting officer"} at ${o.poc_phone}`}
              className={cn(pill.base, pill.outline, "tabular-nums")}
            >
              <Phone aria-hidden="true" />
              {o.poc_phone}
            </a>
          ) : null}
        </div>
      ) : (
        <p className={cn("text-sm text-ink/75", name && "mt-1")}>
          No contact captured yet. The solicitation names the contracting officer.
        </p>
      )}
    </Section>
  );
}

function StepsSection({ o, reference }: { o: Opportunity; reference: Date }) {
  const steps = responseSteps(o, reference);

  return (
    <Section icon={ListChecks} title="How to respond" panel>
      <ol role="list" className="space-y-3">
        {steps.map((step, index) => (
          <li key={`${index}-${step.title}`} className="flex gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-display text-sm font-bold tabular-nums",
                // Passed badges use ink/75 rather than ink/60: ink/60 on this
                // gray badge is ~3.3:1, below AA for 14px text.
                step.passed ? "bg-ink/10 text-ink/75" : "bg-sun text-ink",
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p
                suppressHydrationWarning
                className={cn(
                  "break-words text-sm font-semibold",
                  step.passed ? "text-ink/70 line-through" : "text-ink",
                )}
              >
                {step.title}
                {step.passed ? <span className="sr-only"> (passed)</span> : null}
              </p>
              {step.detail ? (
                <p
                  className={cn(
                    "mt-0.5 break-words text-sm",
                    step.passed ? "text-ink/70" : "text-ink/75",
                  )}
                >
                  {step.detail}
                </p>
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
  const shownVendors = vendors.slice(0, VENDOR_LIMIT);
  const hiddenVendors = vendors.slice(VENDOR_LIMIT);
  const incumbent = o.incumbent?.trim();
  const url = o.interested_vendors_url?.trim();

  return (
    <Section icon={Users} title="Competition" panel>
      {incumbent || vendors.length || url ? (
        <div className="space-y-3">
          {incumbent ? (
            <p className="break-words text-sm text-ink/80">
              Incumbent: <strong className="font-bold text-ink">{incumbent}</strong>
            </p>
          ) : null}
          {vendors.length ? (
            <div>
              <p className="text-xs font-semibold tabular-nums text-ink/70">
                {vendors.length} interested {vendors.length === 1 ? "vendor" : "vendors"}
              </p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {shownVendors.map((vendor, index) => (
                  <li key={`${index}-${vendor}`} className={chip}>
                    <span className="truncate">{vendor}</span>
                  </li>
                ))}
                {hiddenVendors.length ? (
                  <li className={chip} title={hiddenVendors.join(", ")}>
                    <span className="tabular-nums">+{hiddenVendors.length} more</span>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-1.5 rounded text-sm font-semibold text-forest underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30"
            >
              See the public vendor list
              <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          <p className="text-xs text-ink/70">
            Bids stay sealed until opening or award, so this is what&apos;s public.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink/75">No public competitor info yet.</p>
      )}
    </Section>
  );
}

function CodeValue({ code, target, label }: { code: string; target: boolean; label: string }) {
  if (!target) return <span className="tabular-nums">{code}</span>;
  return (
    <span className={cn("tabular-nums", targetCode)} title={label}>
      {code}
      <span className="sr-only"> (target code)</span>
    </span>
  );
}

function DetailsSection({ o }: { o: Opportunity }) {
  const value = formatCurrency(o.value);
  const naics = naicsList(o);
  const psc = pscOf(o);
  const details: { label: string; value: ReactNode }[] = [];

  if (o.notice_id) {
    details.push({
      label: "Solicitation #",
      value: <span className="break-all tabular-nums">{o.notice_id}</span>,
    });
  }
  if (o.set_aside) details.push({ label: "Set-aside", value: o.set_aside });
  if (value !== "Not Specified") {
    details.push({ label: "Value", value: <span className="tabular-nums">{value}</span> });
  }
  if (naics.length) {
    details.push({
      label: "NAICS",
      value: (
        <span className="flex flex-wrap gap-x-1.5 gap-y-1">
          {naics.map((code, index) => (
            <CodeValue
              key={`${index}-${code}`}
              code={code}
              target={TARGET_NAICS.has(code)}
              label="Target LIMS-consulting NAICS code"
            />
          ))}
        </span>
      ),
    });
  }
  if (psc) {
    details.push({
      label: "PSC",
      value: (
        <CodeValue
          code={psc}
          target={TARGET_PSC.has(psc)}
          label="Target LIMS-consulting product service code"
        />
      ),
    });
  }
  if (o.notice_type) details.push({ label: "Notice type", value: o.notice_type });

  if (!details.length) return null;

  return (
    <Section icon={Info} title="Details">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {details.map((detail) => (
          <div key={detail.label} className="min-w-0">
            <dt className="text-xs font-semibold text-ink/70">{detail.label}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{detail.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function DrawerBody({ o, now }: { o: Opportunity; now: number }) {
  const reference = new Date(now);
  const life = lifecycleOf(o, reference);
  const requirements = requirementsList(o);
  const keywords = visibleKeywords(o, 10);
  const fit = o.customer_fit_notes?.trim();
  const summary = o.summary?.trim();

  return (
    // Phones: the header scrolls away with the body so a long title can't eat the
    // screen. From sm up the header stays put and only the body scrolls.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:overflow-hidden">
      <SheetHeader className="shrink-0 space-y-0 border-b-2 border-cream-edge p-5 pr-16 text-left sm:p-6 sm:pr-16">
        <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
          {o.notice_type ? <TypeStamp>{o.notice_type}</TypeStamp> : null}
          {life.closed ? <ClosedSticker /> : <MatchSticker score={scoreOf(o)} />}
        </div>
        <SheetTitle className="mt-3 break-words font-serif text-2xl font-bold leading-snug text-ink">
          {o.title}
        </SheetTitle>
        {o.agency ? (
          <p className="mt-1.5 break-words text-sm font-semibold text-ink/75">{o.agency}</p>
        ) : null}
        {o.place_of_performance ? (
          <p className="mt-1 flex items-start gap-1.5 text-sm text-ink/75">
            <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
            <span className="min-w-0 break-words">{o.place_of_performance}</span>
          </p>
        ) : null}
        <SheetDescription className="sr-only">
          Details, deadlines and contact for this opportunity
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-4 p-5 sm:min-h-0 sm:overflow-y-auto sm:p-6">
        <DeadlineSection o={o} life={life} reference={reference} />
        <ContactSection o={o} />
        <StepsSection o={o} reference={reference} />
        <CompetitionSection o={o} />

        {fit ? (
          <Section icon={Sparkles} title="Why it fits">
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink/80">
              {fit}
            </p>
          </Section>
        ) : null}

        {summary ? (
          <Section icon={FileText} title="Description">
            <p className="whitespace-pre-line break-words text-sm leading-relaxed text-ink/80">
              {summary}
            </p>
          </Section>
        ) : null}

        {requirements.length ? (
          <Section icon={CheckCircle2} title="Key requirements">
            <ul className="space-y-1.5">
              {requirements.map((requirement, index) => (
                <li key={`${index}-${requirement}`} className="flex gap-2 text-sm text-ink/80">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-leaf" />
                  <span className="min-w-0 break-words">{requirement}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <DetailsSection o={o} />

        {keywords.length ? (
          <Section icon={Tags} title="Keywords">
            <ul className="flex flex-wrap gap-1.5">
              {keywords.map((keyword, index) => (
                <li key={`${index}-${keyword}`} className={chip}>
                  <span className="truncate">{keyword}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
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

  const o = opportunity ?? shown;
  const open = Boolean(opportunity);
  const saved = o ? isSaved(o.id) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-0 bg-cream p-0 text-ink sm:max-w-lg"
      >
        {o ? (
          <>
            <DrawerBody o={o} now={now} />

            <div className="flex shrink-0 items-center gap-2 border-t-2 border-cream-edge p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => toggle(o.id)}
                className={cn(pill.base, pill.ghost)}
              >
                <Bookmark aria-hidden="true" className={cn(saved && "fill-forest text-forest")} />
                {saved ? "Saved" : "Save"}
              </button>
              {o.sam_link ? (
                <a
                  href={o.sam_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(pill.base, pill.forest, "flex-1 focus-visible:ring-forest/30")}
                >
                  View &amp; apply
                  <ExternalLink aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </>
        ) : (
          <SheetHeader className="p-6">
            <SheetTitle className="sr-only">Opportunity details</SheetTitle>
            <SheetDescription className="sr-only">
              Details, deadlines and contact for this opportunity
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
