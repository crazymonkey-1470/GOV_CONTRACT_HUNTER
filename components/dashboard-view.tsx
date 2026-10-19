"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Bookmark,
  Briefcase,
  CalendarX,
  Clock4,
  LayoutGrid,
  List,
  Search,
  SearchX,
  Target,
  X,
} from "lucide-react";

import { ContractCard } from "@/components/contract-card";
import { ContractDrawer } from "@/components/contract-drawer";
import { ContractTable } from "@/components/contract-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSaved } from "@/components/saved-provider";
import { naicsList, scoreOf } from "@/lib/contracts";
import { DISPLAY_TIME_ZONE, deadlineInstant } from "@/lib/format";
import { lifecycleOf } from "@/lib/lifecycle";
import { codePriority, priorityRank } from "@/lib/priority";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

type Status = "active" | "expired";
type SortKey = "match" | "deadline" | "recent";
type ViewMode = "cards" | "table";
/** Stat-card filters: each shows exactly what its card counts. */
type Bubble = "closing" | "strong";

const BUBBLE_LABELS: Record<Bubble, string> = {
  closing: "Closing this week",
  strong: "Matched ≥ 80%",
};

const STRONG_MATCH = 80;

const SORT_KEYS: SortKey[] = ["match", "deadline", "recent"];

function sortLabel(key: SortKey, status: Status): string {
  if (key === "match") return "Best match";
  if (key === "recent") return "Recently added";
  // Nothing on the Expired tab is closing, so this sort shows the latest ones first.
  return status === "expired" ? "Recently expired" : "Closing soonest";
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
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [view, setView] = useState<ViewMode>("cards");
  const [openId, setOpenId] = useState<string | null>(null);
  const allChipRef = useRef<HTMLButtonElement>(null);

  // Re-evaluate "expired" periodically so classification/counts stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  /** After a stat card changes the list, bring its top back into view. */
  const showResults = useCallback(() => {
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
  }, []);

  // "#saved" in the URL (the sidebar's Saved link) turns the Saved filter on.
  useEffect(() => {
    if (window.location.hash === SAVED_HASH) setSavedOnly(true);
    const onHashChange = () => setSavedOnly(window.location.hash === SAVED_HASH);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
    setBubble(null);
  }, [setSavedFilter]);

  /** Switching tabs drops a stat-card filter (they only apply to active opportunities). */
  const changeStatus = useCallback((next: Status) => {
    setStatus(next);
    setBubble(null);
  }, []);

  const { activeAll, expiredAll, closingSoonIds } = useMemo(() => {
    const reference = new Date(now);
    const active: Opportunity[] = [];
    const expired: Opportunity[] = [];
    const soon = new Set<string>();
    for (const opportunity of opportunities) {
      const life = lifecycleOf(opportunity, reference);
      if (life.closed) {
        expired.push(opportunity);
      } else {
        active.push(opportunity);
        if (life.deadline.status === "soon") soon.add(opportunity.id);
      }
    }
    return { activeAll: active, expiredAll: expired, closingSoonIds: soon };
  }, [opportunities, now]);

  // Saved ids can outlive their rows (deleted, or now below the score cutoff), so count loaded ones.
  const savedCount = useMemo(
    () => opportunities.filter((o) => isSaved(o.id)).length,
    [opportunities, isSaved],
  );

  const strongMatches = useMemo(
    () => activeAll.filter((o) => scoreOf(o) >= STRONG_MATCH).length,
    [activeAll],
  );

  /** The same rules the stat counts use, so a card shows exactly its number. */
  const inBubble = useCallback(
    (o: Opportunity, which: Bubble) =>
      which === "closing" ? closingSoonIds.has(o.id) : scoreOf(o) >= STRONG_MATCH,
    [closingSoonIds],
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

  const tabAll = status === "active" ? activeAll : expiredAll;
  const otherAll = status === "active" ? expiredAll : activeAll;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tabAll.filter((o) => {
      if (bubble && !inBubble(o, bubble)) return false;
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
      // Active: soonest deadline first. Expired: most recent first.
      // Either way, opportunities without a deadline go last.
      const direction = status === "expired" ? -1 : 1;
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
  }, [tabAll, status, bubble, inBubble, setAside, savedOnly, priorityOnly, query, sort, isSaved, searchIndex]);

  const openOpportunity = openId
    ? (opportunities.find((o) => o.id === openId) ?? null)
    : null;

  const filtersActive =
    query.trim() !== "" || setAside !== "all" || savedOnly || priorityOnly || bubble !== null;

  /** Open / Expired cards jump to that whole tab. */
  const jumpTo = (nextStatus: Status) => {
    clearFilters();
    setStatus(nextStatus);
    showResults();
  };

  /** Closing / Matched cards show only what they count (clearing search and other filters). */
  const showBubble = (which: Bubble, nextSort: SortKey) => {
    clearFilters();
    setStatus("active");
    setSort(nextSort);
    setBubble(which);
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
    const other: Status = status === "active" ? "expired" : "active";
    if (savedOnly && savedHere === 0 && savedElsewhere > 0) {
      empty = {
        icon: Bookmark,
        title:
          other === "expired"
            ? "Your saved opportunities have expired"
            : "Your saved opportunities are still active",
        description: `Switch to the ${other === "expired" ? "Expired" : "Active"} tab to see them.`,
        action: {
          label: other === "expired" ? "Show expired" : "Show active",
          onClick: () => changeStatus(other),
        },
      };
    } else if (bubble && !tabAll.some((o) => inBubble(o, bubble))) {
      empty = {
        icon: bubble === "closing" ? CalendarX : Target,
        title: bubble === "closing" ? "Nothing closes this week" : "No matches at 80% or higher yet",
        description:
          bubble === "closing"
            ? "No active opportunity closes in the next 7 days."
            : "No active opportunity scores 80 or more yet.",
        action: { label: "Show all active", onClick: () => setBubble(null) },
      };
    } else if (tabAll.length === 0) {
      empty =
        status === "active"
          ? {
              icon: SearchX,
              title: "No active opportunities",
              description: "New contracts will appear here as your agents find them.",
            }
          : {
              icon: CalendarX,
              title: "No expired opportunities",
              description: "Opportunities past their response deadline will collect here.",
            };
    } else if (savedOnly && savedHere === 0) {
      empty = {
        icon: Bookmark,
        title: "No saved opportunities",
        description: "Tap the bookmark on any card to save it here.",
        action: { label: "Clear filters", onClick: clearFilters },
      };
    } else {
      empty = {
        icon: SearchX,
        title: "No matches",
        description: "Try a different search term, set-aside, or sort.",
        action: { label: "Clear filters", onClick: clearFilters },
      };
    }
  }

  const noun = visible.length === 1 ? "opportunity" : "opportunities";
  const countText = `${visible.length} ${status === "expired" ? "expired " : ""}${noun}${
    bubble === "closing" ? " closing this week" : bubble === "strong" ? " matched ≥ 80%" : ""
  }${savedOnly ? " you saved" : ""}`;

  return (
    <div>
      {/* Header */}
      <header className="z-20 border-b bg-background/85 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Open Opportunities</h1>
              <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                {today}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative" role="search">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // Close the phone keyboard so the results are visible.
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  enterKeyHint="search"
                  placeholder="Search…"
                  className="w-44 pl-9 sm:w-64"
                  aria-label="Search opportunities"
                />
              </div>
              <div className="flex rounded-lg border bg-card p-0.5">
                <IconToggle
                  icon={LayoutGrid}
                  label="Card view"
                  active={view === "cards"}
                  onClick={() => setView("cards")}
                />
                <IconToggle
                  icon={List}
                  label="Table view"
                  active={view === "table"}
                  onClick={() => setView("table")}
                />
              </div>
            </div>
          </div>

          {/* At-a-glance numbers; each one shows the list it counts. */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={Briefcase}
              label="Open opportunities"
              value={activeAll.length}
              action="Show active opportunities"
              onClick={() => jumpTo("active")}
            />
            <StatCard
              icon={Clock4}
              label={BUBBLE_LABELS.closing}
              value={closingSoonIds.size}
              tone="text-amber-600"
              action="Show only these, closing soonest first"
              pressed={bubble === "closing"}
              onClick={() => showBubble("closing", "deadline")}
            />
            <StatCard
              icon={Target}
              label={BUBBLE_LABELS.strong}
              value={strongMatches}
              tone="text-emerald-600"
              action="Show only these, best match first"
              pressed={bubble === "strong"}
              onClick={() => showBubble("strong", "match")}
            />
            <StatCard
              icon={CalendarX}
              label="Expired"
              value={expiredAll.length}
              tone="text-muted-foreground"
              action="Show expired opportunities"
              onClick={() => jumpTo("expired")}
            />
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-card p-0.5 text-sm">
            <SegmentButton active={status === "active"} onClick={() => changeStatus("active")}>
              Active{" "}
              <span className="tabular-nums opacity-70" suppressHydrationWarning>
                ({activeAll.length})
              </span>
            </SegmentButton>
            <SegmentButton active={status === "expired"} onClick={() => changeStatus("expired")}>
              Expired{" "}
              <span className="tabular-nums opacity-70" suppressHydrationWarning>
                ({expiredAll.length})
              </span>
            </SegmentButton>
          </div>

          {/* Phones: one sideways-scrolling row of chips. From sm up the wrapper
              disappears (display: contents) and the chips wrap with the controls. */}
          <div className="-mx-4 flex w-full gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] sm:contents [&::-webkit-scrollbar]:hidden">
            {bubble ? (
              <Chip
                active
                onClick={() => {
                  setBubble(null);
                  // The chip disappears, so keep keyboard focus in the chip row.
                  allChipRef.current?.focus();
                }}
                ariaLabel={`Remove filter: ${BUBBLE_LABELS[bubble]}`}
              >
                {BUBBLE_LABELS[bubble]}
                <X className="h-3.5 w-3.5" />
              </Chip>
            ) : null}
            <Chip
              buttonRef={allChipRef}
              active={setAside === "all"}
              onClick={() => setSetAside("all")}
            >
              All
            </Chip>
            {setAsideOptions.map((option) => (
              <Chip
                key={option}
                active={setAside === option}
                onClick={() => setSetAside(option)}
                title={option}
                className="max-w-[16rem]"
              >
                <span className="truncate">{option}</span>
              </Chip>
            ))}

            <button
              type="button"
              onClick={() => setPriorityOnly((value) => !value)}
              aria-pressed={priorityOnly}
              title={PRIORITY_CODES_TITLE}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                priorityOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Target className="h-3.5 w-3.5" />
              Priority codes
            </button>

            <button
              type="button"
              onClick={() => setSavedFilter(!savedOnly)}
              aria-pressed={savedOnly}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                savedOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              <Bookmark className={cn("h-3.5 w-3.5", savedOnly && "fill-current")} />
              Saved{savedCount > 0 ? ` (${savedCount})` : ""}
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <label htmlFor="sort" className="text-xs text-muted-foreground">
              Sort
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {SORT_KEYS.map((key) => (
                <option key={key} value={key}>
                  {sortLabel(key, status)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
        <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground" aria-live="polite" suppressHydrationWarning>
            {countText}
          </p>
          {filtersActive && visible.length > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>

        {empty ? (
          <EmptyState {...empty} />
        ) : view === "cards" ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
      </div>

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

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  action,
  pressed,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: string;
  action: string;
  /** Set for filter cards: exposes aria-pressed and outlines the selected one. */
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${value}. ${action}`}
      aria-pressed={pressed}
      suppressHydrationWarning
      className={cn(
        "rounded-xl border bg-card p-3 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        pressed && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn("h-4 w-4 shrink-0", tone)} />
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums" suppressHydrationWarning>
        {value}
      </div>
    </button>
  );
}

function IconToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "rounded-md p-1.5 transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md px-3 py-1 font-medium transition-colors",
        active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  title,
  ariaLabel,
  className,
  buttonRef,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  ariaLabel?: string;
  className?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaLabel ? undefined : active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {action ? (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
