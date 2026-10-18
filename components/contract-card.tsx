"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  CircleDollarSign,
  ExternalLink,
  Mail,
  MapPin,
  MessageCircleQuestion,
  Phone,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";

import { ClosedSticker, MatchSticker, TimeBar, TypeStamp, pill } from "@/components/bubbly";
import { useSaved } from "@/components/saved-provider";
import { emailHref, phoneHref } from "@/lib/contact";
import { competitionSummary } from "@/lib/contracts";
import { formatCurrency, formatDeadline } from "@/lib/format";
import { lifecycleOf, windowUsed } from "@/lib/lifecycle";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

type Fact = { key: string; icon: LucideIcon; text: string };

function factsFor(o: Opportunity): Fact[] {
  const facts: Fact[] = [];
  if (o.questions_deadline) {
    facts.push({
      key: "questions",
      icon: MessageCircleQuestion,
      text: `Questions by ${formatDeadline(o.questions_deadline)}`,
    });
  }
  const value = formatCurrency(o.value);
  if (value !== "Not Specified") facts.push({ key: "value", icon: CircleDollarSign, text: value });
  if (o.set_aside) facts.push({ key: "set-aside", icon: ShieldCheck, text: o.set_aside });
  if (o.place_of_performance) {
    facts.push({ key: "place", icon: MapPin, text: o.place_of_performance });
  }
  if (o.submission_method) facts.push({ key: "submit", icon: Send, text: o.submission_method });
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
  const soon = life.deadline.status === "soon";
  const email = emailHref(o, "question");
  const tel = phoneHref(o.poc_phone);
  const facts = factsFor(o);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();

  return (
    <article
      onClick={onOpen}
      className="flex min-w-0 cursor-pointer flex-col rounded-bubble bg-cream p-5 text-ink shadow-bubble [overflow-wrap:anywhere]"
    >
      <div className="flex min-h-7 items-start justify-between gap-3">
        {o.notice_type ? <TypeStamp>{o.notice_type}</TypeStamp> : <span />}
        {life.closed ? <ClosedSticker /> : <MatchSticker score={o.relevance_score} />}
      </div>

      <h3 className="mt-3 font-serif text-xl font-bold leading-snug">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="line-clamp-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30"
        >
          {o.title}
        </button>
      </h3>
      {o.agency ? <p className="mt-1 line-clamp-1 text-sm text-ink/75">{o.agency}</p> : null}

      <div className="mt-4">
        <p className="text-sm text-ink/70" suppressHydrationWarning>
          {life.closed ? (
            life.reason
          ) : o.response_deadline ? (
            <>
              Responses close{" "}
              <strong className="font-bold text-ink">{formatDeadline(o.response_deadline)}</strong>
            </>
          ) : (
            "No deadline listed yet"
          )}
        </p>
        {!life.closed && o.response_deadline ? (
          <div className="mt-2 flex items-center gap-3">
            <TimeBar used={windowUsed(o, reference)} tone={soon ? "ember" : "leaf"} />
            <span
              suppressHydrationWarning
              className={cn(
                "shrink-0 font-display text-sm font-semibold",
                soon ? "text-ember-ink" : "text-leaf",
              )}
            >
              {life.deadline.label}
            </span>
          </div>
        ) : null}
      </div>

      {facts.length ? (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {facts.map(({ key, icon: Icon, text }) => (
            <li
              key={key}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-cream-edge px-2.5 py-1 text-xs font-semibold text-ink/80"
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-forest" />
              <span className="truncate" suppressHydrationWarning>
                {text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {o.summary ? (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink/70">{o.summary}</p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {email ? (
          <a href={email} onClick={stop} className={cn(pill.base, pill.sun)}>
            <Mail />
            Email CO
          </a>
        ) : null}
        {tel ? (
          <a
            href={tel}
            onClick={stop}
            aria-label={`Call ${o.poc_name ?? "the contracting officer"}`}
            title={o.poc_phone ?? undefined}
            className={cn(pill.base, pill.forest, pill.icon, "focus-visible:ring-forest/30")}
          >
            <Phone />
          </a>
        ) : null}
        {o.sam_link ? (
          <a
            href={o.sam_link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={stop}
            className={cn(pill.base, pill.outline)}
          >
            View &amp; apply
            <ExternalLink />
          </a>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            toggle(o.id);
          }}
          aria-label="Save opportunity"
          aria-pressed={saved}
          className={cn(pill.base, pill.ghost, pill.icon, "ml-auto")}
        >
          <Bookmark className={cn(saved && "fill-forest text-forest")} />
        </button>
      </div>
    </article>
  );
}
