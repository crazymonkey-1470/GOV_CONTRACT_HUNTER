"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  CalendarClock,
  CalendarX,
  DollarSign,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Phone,
  Send,
  Users,
} from "lucide-react";

import { MatchBadge } from "@/components/match-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSaved } from "@/components/saved-provider";
import { emailHref, phoneHref } from "@/lib/contact";
import { competitionSummary, deadlineToneClass, naicsList } from "@/lib/contracts";
import { formatCurrency, formatDeadline, getDeadlineInfo } from "@/lib/format";
import { lifecycleOf } from "@/lib/lifecycle";
import { TARGET_NAICS } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

type Fact = {
  key: string;
  icon: LucideIcon;
  text: string;
  muted?: boolean;
  /** Makes the fact a link (e.g. tap to call). */
  href?: string;
  label?: string;
};

/** At-a-glance bid facts shown under the deadline, in order of usefulness. */
function factsFor(o: Opportunity, reference: Date): Fact[] {
  const facts: Fact[] = [];
  if (o.questions_deadline) {
    const passed = getDeadlineInfo(o.questions_deadline, reference).status === "expired";
    facts.push({
      key: "questions",
      icon: MessageCircleQuestion,
      text: `Questions ${passed ? "were due" : "due"} ${formatDeadline(o.questions_deadline)}`,
      muted: passed,
    });
  }
  const value = formatCurrency(o.value);
  if (value !== "Not Specified") facts.push({ key: "value", icon: DollarSign, text: value });
  if (o.place_of_performance) {
    facts.push({ key: "place", icon: MapPin, text: o.place_of_performance });
  }
  if (o.submission_method) {
    facts.push({ key: "submit", icon: Send, text: `Submit via ${o.submission_method}` });
  }
  const tel = phoneHref(o.poc_phone);
  if (tel && o.poc_phone) {
    facts.push({
      key: "phone",
      icon: Phone,
      text: o.poc_phone,
      href: tel,
      label: `Call ${o.poc_name ?? "the contracting officer"} at ${o.poc_phone}`,
    });
  }
  const competition = competitionSummary(o);
  if (competition) facts.push({ key: "competition", icon: Users, text: competition });
  return facts;
}

export function ContractCard({
  opportunity: o,
  now,
  onOpen,
}: {
  opportunity: Opportunity;
  now: number;
  onOpen: () => void;
}) {
  const { isSaved, toggle } = useSaved();
  const saved = isSaved(o.id);
  const reference = new Date(now);
  const life = lifecycleOf(o, reference);
  const { deadline } = life;
  const email = emailHref(o, "question");
  const facts = factsFor(o, reference);

  // Prefer showing a target LIMS-consulting code when the notice carries one.
  const allNaics = naicsList(o);
  const naics = allNaics.find((code) => TARGET_NAICS.has(code)) ?? allNaics[0];
  const naicsIsTarget = naics ? TARGET_NAICS.has(naics) : false;

  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const hasActions = Boolean(email || o.sam_link);

  return (
    <article
      onClick={onOpen}
      className="group flex min-w-0 cursor-pointer flex-col rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md [overflow-wrap:anywhere]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug text-foreground">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="line-clamp-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {o.title}
            </button>
          </h3>
          {o.agency ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{o.agency}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle(o.id);
          }}
          aria-label="Save opportunity"
          aria-pressed={saved}
          className="-m-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bookmark className={cn("h-4 w-4", saved && "fill-primary text-primary")} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <MatchBadge score={o.relevance_score} />
        {o.set_aside ? (
          <Badge variant="secondary" className="max-w-full" title={o.set_aside}>
            <span className="truncate">{o.set_aside}</span>
          </Badge>
        ) : null}
        {o.notice_type ? <Badge variant="outline">{o.notice_type}</Badge> : null}
        {naics ? (
          <Badge
            variant="outline"
            className={cn("font-mono text-[11px]", naicsIsTarget && "border-primary/50 text-primary")}
            title={naicsIsTarget ? "Target LIMS-consulting NAICS code" : undefined}
          >
            NAICS {naics}
          </Badge>
        ) : null}
      </div>

      {o.summary ? (
        <p className="mt-2.5 line-clamp-2 text-sm leading-relaxed text-foreground/75">
          {o.summary}
        </p>
      ) : null}

      {/* The response deadline (date, time and countdown), then the bid facts. */}
      <div className="mt-3 space-y-1 text-sm">
        {life.closed ? (
          <p className="flex items-start gap-1.5 font-medium text-destructive" suppressHydrationWarning>
            <CalendarX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0">{life.reason}</span>
          </p>
        ) : deadline.status === "none" ? (
          <p className="flex items-start gap-1.5 text-muted-foreground">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>No deadline listed yet</span>
          </p>
        ) : (
          <p className="flex items-start gap-1.5" suppressHydrationWarning>
            <CalendarClock
              className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", deadlineToneClass(deadline.status))}
            />
            <span className="min-w-0">
              <span className="font-medium text-foreground">
                Due {formatDeadline(o.response_deadline)}
              </span>
              <span className={cn("whitespace-nowrap font-medium", deadlineToneClass(deadline.status))}>
                {" "}
                · {deadline.label}
              </span>
            </span>
          </p>
        )}

        {facts.map(({ key, icon: Icon, text, muted, href, label }) =>
          href ? (
            <p key={key} className="flex items-start gap-1.5">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <a
                href={href}
                onClick={stop}
                aria-label={label}
                className="min-w-0 rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {text}
              </a>
            </p>
          ) : (
            <p
              key={key}
              className={cn(
                "flex items-start gap-1.5 text-muted-foreground",
                muted && "line-through decoration-muted-foreground/60",
              )}
              suppressHydrationWarning
            >
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">{text}</span>
            </p>
          ),
        )}
      </div>

      {hasActions ? (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {email ? (
            <Button asChild size="sm" className="shrink-0">
              <a href={email} onClick={stop}>
                <Mail />
                Email CO
              </a>
            </Button>
          ) : null}
          {o.sam_link ? (
            <Button asChild size="sm" variant="outline" className="ml-auto shrink-0">
              <a href={o.sam_link} target="_blank" rel="noopener noreferrer" onClick={stop}>
                View &amp; Apply
                <ExternalLink />
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
