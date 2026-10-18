"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  CalendarX,
  ChevronDown,
  LayoutGrid,
  List,
  Search,
  SearchX,
  Sprout,
  Target,
} from "lucide-react";

import { SectionHeading, pill } from "@/components/bubbly";
import { ContractCard } from "@/components/contract-card";
import { ContractDrawer } from "@/components/contract-drawer";
import { ContractTable } from "@/components/contract-table";
import { useSaved } from "@/components/saved-provider";
import { naicsList, scoreOf } from "@/lib/contracts";
import { DISPLAY_TIME_ZONE, deadlineInstant } from "@/lib/format";
import { lifecycleOf } from "@/lib/lifecycle";
import { codePriority, priorityRank } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

type Status = "active" | "closed";
type SortKey = "match" | "deadline" | "recent";
type ViewMode = "cards" | "table";

const SORT_KEYS: SortKey[] = ["match", "deadline", "recent"];

function sortLabel(key: SortKey, status: Status): string {
  if (key === "match") return "Best match";
  if (key === "recent") return "Recently added";
  // Nothing on the Closed tab is closing, so this sort shows the latest closures first.
  return status === "closed" ? "Recently closed" : "Closing soonest";
}

const PRIORITY_CODES_TITLE =
  "Only opportunities carrying a target LIMS-consulting NAICS (541512, 541511, 541690, 541611, 541519) or PSC (DA01, DJ01, DB02, R425, R408, R499)";

const SAVED_HASH = "#saved";

function searchText(o: Opportunity): string {
  return [
    o.title,
    o.agency,
    o.summary,
    o.notice_id,
    naicsList(o).join(" "),
    o.place_of_performance,
    o.incumbent,
    o.submission_method,
    o.poc_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Classes for an interactive chip / toggle sitting on cream (house convention). */
function chipClass(selected: boolean) {
  return cn(
    pill.base,
    "focus-visible:ring-forest/30",
    selected
      ? "bg-forest text-sun hover:bg-forest-deep"
      : "bg-cream-edge text-ink/80 hover:bg-ink/10 hover:text-ink",
  );
}

/** Classes for a button inside a cream-edge segmented group. */
function segmentClass(selected: boolean) {
  return cn(
    pill.base,
    "focus-visible:ring-forest/30",
    selected ? "bg-forest text-sun" : "text-ink/75 hover:text-ink",
  );
}

export function DashboardView({
  opportunities,
}: {
  opportunities: Opportunity[];
}) {
  const { isSaved } = useSaved();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [setAside, setSetAside] = useState<string>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("match");
  const [view, setView] = useState<ViewMode>("cards");
  const [openId, setOpenId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLElement>(null);

  // Re-evaluate "closed" periodically so the split and counts stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** On phones the results start below the fold, so jump to them (no smooth scroll). */
  const showResults = useCallback(() => {
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    resultsRef.current?.scrollIntoView({ block: "start" });
  }, []);

  // "#saved" in the URL (the header's Saved link) turns the Saved filter on.
  useEffect(() => {
    if (window.location.hash === SAVED_HASH) {
      setSavedOnly(true);
      showResults();
    }
    // AppHeader re-stamps native "#saved" history entries for Next's router.
    const onHashChange = () => {
      const on = window.location.hash === SAVED_HASH;
      setSavedOnly(on);
      if (on) showResults();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [showResults]);

  /** Toggle the Saved filter and keep the "#saved" hash in step, without a history entry. */
  const setSavedFilter = useCallback((on: boolean) => {
    setSavedOnly(on);
    const hasHash = window.location.hash === SAVED_HASH;
    if (on === hasHash) return;
    const url = window.location.pathname + window.location.search + (on ? SAVED_HASH : "");
    window.history.replaceState(null, "", url);
  }, []);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSetAside("all");
    setPriorityOnly(false);
    setSavedFilter(false);
  }, [setSavedFilter]);

  const { activeAll, closedAll, closingSoon } = useMemo(() => {
    const reference = new Date(now);
    const active: Opportunity[] = [];
    const closed: Opportunity[] = [];
    let soon = 0;
    for (const opportunity of opportunities) {
      const life = lifecycleOf(opportunity, reference);
      if (life.closed) {
        closed.push(opportunity);
      } else {
        active.push(opportunity);
        if (life.deadline.status === "soon") soon += 1;
      }
    }
    return { activeAll: active, closedAll: closed, closingSoon: soon };
  }, [opportunities, now]);

  // Saved ids can outlive their rows (deleted, or now below the score cutoff), so count loaded ones.
  const savedCount = useMemo(
    () => opportunities.filter((o) => isSaved(o.id)).length,
    [opportunities, isSaved],
  );

  const strongMatches = useMemo(
    () => activeAll.filter((o) => scoreOf(o) >= 80).length,
    [activeAll],
  );

  const setAsideOptions = useMemo(() => {
    const values = new Set<string>();
    for (const o of opportunities) if (o.set_aside) values.add(o.set_aside);
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [opportunities]);

  const searchIndex = useMemo(
    () => new Map(opportunities.map((o) => [o.id, searchText(o)])),
    [opportunities],
  );

  const tabAll = status === "active" ? activeAll : closedAll;
  const otherAll = status === "active" ? closedAll : activeAll;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tabAll.filter((o) => {
      if (setAside !== "all" && o.set_aside !== setAside) return false;
      if (savedOnly && !isSaved(o.id)) return false;
      if (priorityOnly && codePriority(o) === null) return false;
      if (!q) return true;
      return (searchIndex.get(o.id) ?? "").includes(q);
    });

    const sorted = [...filtered];
    if (sort === "match") {
      // Score first; among equal scores, target-code opportunities
      // (541512 ahead of the other target NAICS/PSCs) rank higher.
      sorted.sort(
        (a, b) =>
          scoreOf(b) - scoreOf(a) ||
          priorityRank(a) - priorityRank(b) ||
          (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
    } else if (sort === "deadline") {
      // Active: soonest deadline first. Closed: most recently closed first.
      // Either way, opportunities without a deadline go last.
      const direction = status === "closed" ? -1 : 1;
      const times = new Map(sorted.map((o) => [o.id, deadlineInstant(o.response_deadline)]));
      sorted.sort((a, b) => {
        const ta = times.get(a.id) ?? null;
        const tb = times.get(b.id) ?? null;
        if (ta === null || tb === null) {
          if (ta === tb) return scoreOf(b) - scoreOf(a);
          return ta === null ? 1 : -1;
        }
        return direction * (ta - tb) || scoreOf(b) - scoreOf(a);
      });
    } else {
      sorted.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    }
    return sorted;
  }, [tabAll, status, setAside, savedOnly, priorityOnly, query, sort, isSaved, searchIndex]);

  const openOpportunity = openId
    ? (opportunities.find((o) => o.id === openId) ?? null)
    : null;

  const filtersActive =
    query.trim() !== "" || setAside !== "all" || savedOnly || priorityOnly;

  /** Stat bubbles jump to the full list they summarize. */
  const jumpTo = (nextStatus: Status, nextSort?: SortKey) => {
    clearFilters();
    setStatus(nextStatus);
    if (nextSort) setSort(nextSort);
    showResults();
  };

  const today = new Date(now).toLocaleDateString("en-US", {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let empty: EmptyStateProps | null = null;
  if (visible.length === 0) {
    const savedHere = savedOnly ? tabAll.filter((o) => isSaved(o.id)).length : 0;
    const savedElsewhere = savedOnly ? otherAll.filter((o) => isSaved(o.id)).length : 0;
    const other: Status = status === "active" ? "closed" : "active";
    if (savedOnly && savedHere === 0 && savedElsewhere > 0) {
      empty = {
        icon: Bookmark,
        title: other === "closed" ? "Your saved ones have closed" : "Your saved ones are still open",
        message: `Switch to the ${other === "closed" ? "Closed" : "Active"} tab to see what you saved.`,
        action: {
          label: other === "closed" ? "Show closed" : "Show active",
          onClick: () => setStatus(other),
        },
      };
    } else if (tabAll.length === 0) {
      empty =
        status === "active"
          ? {
              icon: Sprout,
              title: "No open opportunities yet",
              message: "Check back after your bots' next run, or search the portals on Helpful links.",
            }
          : {
              icon: CalendarX,
              title: "Nothing has closed yet",
              message: "Check the Active tab for what's still open.",
            };
    } else if (savedOnly && savedHere === 0) {
      empty = {
        icon: Bookmark,
        title: "Nothing saved yet",
        message: "Tap the bookmark on a card to save it here.",
        action: { label: "Clear filters", onClick: clearFilters },
      };
    } else {
      empty = {
        icon: SearchX,
        title: "No matches",
        message: "Try a different search or clear the filters.",
        action: { label: "Clear filters", onClick: clearFilters },
      };
    }
  }

  const noun = visible.length === 1 ? "opportunity" : "opportunities";
  const countText = `${visible.length} ${status === "closed" ? "closed " : ""}${noun}${
    savedOnly ? " you saved" : ""
  }`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 pt-6 sm:px-6 sm:pt-8">
      <SectionHeading>Open opportunities</SectionHeading>
      <p className="mt-1.5 text-center text-sm text-cream/70" suppressHydrationWarning>
        {today}
      </p>

      {/* At-a-glance numbers; each one jumps to the list it counts. */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:grid-cols-4">
        <StatBubble
          value={activeAll.length}
          label="Open"
          dot="bg-sun ring-1 ring-ink/20"
          action="Show active opportunities"
          onClick={() => jumpTo("active")}
        />
        <StatBubble
          value={closingSoon}
          label="Closing this week"
          dot="bg-ember"
          action="Show active opportunities, closing soonest first"
          onClick={() => jumpTo("active", "deadline")}
        />
        <StatBubble
          value={strongMatches}
          label="Strong matches 80+"
          dot="bg-leaf"
          action="Show active opportunities, best match first"
          onClick={() => jumpTo("active", "match")}
        />
        <StatBubble
          value={closedAll.length}
          label="Closed"
          dot="bg-ink/30"
          action="Show closed opportunities"
          onClick={() => jumpTo("closed")}
        />
      </div>

      {/* Toolbar */}
      <div className="mt-4 rounded-bubble bg-cream p-3 text-ink shadow-bubble sm:p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div role="search" className="relative min-w-0 sm:min-w-64 sm:flex-1">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/70"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Close the phone keyboard so the results are visible.
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              enterKeyHint="search"
              aria-label="Search opportunities"
              placeholder="Search title, agency, place…"
              className="h-11 w-full rounded-full border-2 border-cream-edge bg-white/80 pl-10 pr-4 text-base text-ink placeholder:text-ink/70 focus-visible:border-forest/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30 sm:text-sm"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="Status"
              className="flex w-full rounded-full bg-cream-edge p-1 sm:inline-flex sm:w-auto"
            >
              <button
                type="button"
                aria-pressed={status === "active"}
                onClick={() => setStatus("active")}
                className={cn(segmentClass(status === "active"), "flex-1 sm:flex-none")}
              >
                Active
                <span className="tabular-nums" suppressHydrationWarning>
                  {activeAll.length}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={status === "closed"}
                onClick={() => setStatus("closed")}
                className={cn(segmentClass(status === "closed"), "flex-1 sm:flex-none")}
              >
                Closed
                <span className="tabular-nums" suppressHydrationWarning>
                  {closedAll.length}
                </span>
              </button>
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <label
                htmlFor="dashboard-sort"
                className="shrink-0 font-display text-sm font-semibold text-ink/75"
              >
                Sort
              </label>
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <select
                  id="dashboard-sort"
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortKey)}
                  className="h-10 w-full min-w-0 appearance-none rounded-full border-2 border-cream-edge bg-white/80 pl-4 pr-9 font-display text-base font-semibold text-ink focus-visible:border-forest/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30 sm:w-auto sm:text-sm"
                >
                  {SORT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {sortLabel(key, status)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/60"
                />
              </div>
            </div>

            <div
              role="group"
              aria-label="Layout"
              className="inline-flex shrink-0 rounded-full bg-cream-edge p-1"
            >
              <button
                type="button"
                aria-label="Card view"
                aria-pressed={view === "cards"}
                onClick={() => setView("cards")}
                className={cn(segmentClass(view === "cards"), pill.icon)}
              >
                <LayoutGrid aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Table view"
                aria-pressed={view === "table"}
                onClick={() => setView("table")}
                className={cn(segmentClass(view === "table"), pill.icon)}
              >
                <List aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* Filter chips: scroll sideways inside the bubble on phones, wrap from sm up. */}
        <div
          role="group"
          aria-label="Filters"
          className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 py-1 [scrollbar-width:none] sm:mx-0 sm:mt-3 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          <button
            type="button"
            aria-pressed={setAside === "all"}
            onClick={() => setSetAside("all")}
            className={cn(chipClass(setAside === "all"), "whitespace-nowrap")}
          >
            All
          </button>
          {setAsideOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={setAside === option}
              onClick={() => setSetAside(option)}
              title={option}
              className={cn(chipClass(setAside === option), "max-w-[16rem] whitespace-nowrap")}
            >
              <span className="min-w-0 truncate">{option}</span>
            </button>
          ))}

          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 self-center bg-ink/15" />

          <button
            type="button"
            aria-pressed={priorityOnly}
            onClick={() => setPriorityOnly((value) => !value)}
            title={PRIORITY_CODES_TITLE}
            className={cn(chipClass(priorityOnly), "whitespace-nowrap")}
          >
            <Target aria-hidden="true" className={cn(!priorityOnly && "text-forest")} />
            Priority codes
          </button>
          <button
            type="button"
            aria-pressed={savedOnly}
            onClick={() => setSavedFilter(!savedOnly)}
            className={cn(chipClass(savedOnly), "whitespace-nowrap")}
          >
            <Bookmark
              aria-hidden="true"
              className={cn(savedOnly ? "fill-current" : "text-forest")}
            />
            Saved
            <span className="rounded-full bg-sun px-1.5 text-xs font-bold tabular-nums text-ink">
              {savedCount}
            </span>
          </button>
        </div>
      </div>

      {/* Results */}
      <section ref={resultsRef} aria-labelledby="results-heading" className="mt-5 scroll-mt-4">
        <h2 id="results-heading" className="sr-only">
          Results
        </h2>
        <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
          <p
            className="min-w-0 text-sm tabular-nums text-cream/80"
            aria-live="polite"
            suppressHydrationWarning
          >
            {countText}
          </p>
          {filtersActive && visible.length > 0 ? (
            <button
              type="button"
              onClick={clearFilters}
              className={cn(pill.base, "px-3 text-sun hover:bg-forest-deep focus-visible:ring-sun/60")}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        {empty ? (
          <EmptyState {...empty} />
        ) : view === "cards" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((opportunity) => (
              <ContractCard
                key={opportunity.id}
                opportunity={opportunity}
                now={now}
                onOpen={() => setOpenId(opportunity.id)}
              />
            ))}
          </div>
        ) : (
          <ContractTable items={visible} now={now} onOpen={setOpenId} />
        )}
      </section>

      <ContractDrawer
        opportunity={openOpportunity}
        now={now}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      />
    </div>
  );
}

function StatBubble({
  value,
  label,
  dot,
  action,
  onClick,
}: {
  value: number;
  label: string;
  dot: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}. ${action}`}
      suppressHydrationWarning
      className="flex min-w-0 items-center gap-3 rounded-bubble bg-cream px-4 py-2.5 text-left text-ink shadow-bubble hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun/60 sm:block sm:p-4"
    >
      <span
        className="block shrink-0 font-display text-2xl font-bold leading-tight tabular-nums sm:text-3xl"
        suppressHydrationWarning
      >
        {value}
      </span>
      <span className="flex min-w-0 items-start gap-2 text-sm font-semibold leading-snug text-ink/75 sm:mt-0.5">
        <span aria-hidden="true" className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", dot)} />
        <span className="min-w-0">{label}</span>
      </span>
    </button>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  message: ReactNode;
  action?: { label: string; onClick: () => void };
}

function EmptyState({ icon: Icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="rounded-bubble bg-cream px-6 py-10 text-center text-ink shadow-bubble">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cream-edge">
        <Icon aria-hidden="true" className="h-7 w-7 text-forest" />
      </div>
      <h3 className="mt-4 font-serif text-xl font-bold">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink/70">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className={cn(pill.base, pill.sun, "mt-5")}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
