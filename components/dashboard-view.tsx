"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
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
} from "lucide-react";

import { ContractCard } from "@/components/contract-card";
import { ContractDrawer } from "@/components/contract-drawer";
import { ContractTable } from "@/components/contract-table";
import { Input } from "@/components/ui/input";
import { useSaved } from "@/components/saved-provider";
import { naicsList, scoreOf } from "@/lib/contracts";
import { getDeadlineInfo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

type Status = "active" | "expired";
type SortKey = "match" | "deadline" | "recent";
type ViewMode = "cards" | "table";

const SORT_LABELS: Record<SortKey, string> = {
  match: "Best match",
  deadline: "Closing soonest",
  recent: "Recently added",
};

export function DashboardView({
  opportunities,
}: {
  opportunities: Opportunity[];
}) {
  const { isSaved, count } = useSaved();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [setAside, setSetAside] = useState<string>("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("match");
  const [view, setView] = useState<ViewMode>("cards");
  const [openId, setOpenId] = useState<string | null>(null);

  // Re-evaluate "expired" periodically so classification/counts stay fresh.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { activeAll, expiredAll } = useMemo(() => {
    const reference = new Date(now);
    const active: Opportunity[] = [];
    const expired: Opportunity[] = [];
    for (const opportunity of opportunities) {
      if (
        getDeadlineInfo(opportunity.response_deadline, reference).status ===
        "expired"
      ) {
        expired.push(opportunity);
      } else {
        active.push(opportunity);
      }
    }
    return { activeAll: active, expiredAll: expired };
  }, [opportunities, now]);

  const setAsideOptions = useMemo(() => {
    const values = new Set<string>();
    for (const o of opportunities) if (o.set_aside) values.add(o.set_aside);
    return [...values].sort();
  }, [opportunities]);

  const stats = useMemo(() => {
    const reference = new Date(now);
    const closingSoon = activeAll.filter(
      (o) => getDeadlineInfo(o.response_deadline, reference).status === "soon",
    ).length;
    const highMatch = activeAll.filter((o) => scoreOf(o) >= 80).length;
    return {
      open: activeAll.length,
      closingSoon,
      highMatch,
      expired: expiredAll.length,
    };
  }, [activeAll, expiredAll, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const reference = new Date(now);
    const base = status === "active" ? activeAll : expiredAll;

    const filtered = base.filter((o) => {
      if (setAside !== "all" && o.set_aside !== setAside) return false;
      if (savedOnly && !isSaved(o.id)) return false;
      if (!q) return true;
      const haystack = [
        o.title,
        o.agency,
        o.summary,
        o.notice_id,
        naicsList(o).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    const sorted = [...filtered];
    if (sort === "match") {
      sorted.sort((a, b) => scoreOf(b) - scoreOf(a));
    } else if (sort === "deadline") {
      const daysOf = (o: Opportunity) => {
        const days = getDeadlineInfo(o.response_deadline, reference).days;
        return days === null ? Number.POSITIVE_INFINITY : days;
      };
      sorted.sort((a, b) => daysOf(a) - daysOf(b));
    } else {
      sorted.sort((a, b) =>
        (b.created_at ?? "").localeCompare(a.created_at ?? ""),
      );
    }
    return sorted;
  }, [activeAll, expiredAll, status, setAside, savedOnly, query, sort, now, isSaved]);

  const openOpportunity = openId
    ? (opportunities.find((o) => o.id === openId) ?? null)
    : null;
  const baseEmpty =
    (status === "active" ? activeAll.length : expiredAll.length) === 0;

  return (
    <div>
      {/* Header */}
      <header className="sticky top-[57px] z-20 border-b bg-background/85 backdrop-blur md:top-0">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">
                Open Opportunities
              </h1>
              <p className="text-sm text-muted-foreground">
                {format(new Date(now), "EEEE, MMMM d, yyyy")}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
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

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard icon={Briefcase} label="Open opportunities" value={stats.open} />
            <StatCard
              icon={Clock4}
              label="Closing this week"
              value={stats.closingSoon}
              tone="text-amber-600"
            />
            <StatCard
              icon={Target}
              label="Matched ≥ 80%"
              value={stats.highMatch}
              tone="text-emerald-600"
            />
            <StatCard
              icon={CalendarX}
              label="Expired"
              value={stats.expired}
              tone="text-muted-foreground"
            />
          </div>
        </div>
      </header>

      {/* Controls */}
      <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border bg-card p-0.5 text-sm">
            <SegmentButton
              active={status === "active"}
              onClick={() => setStatus("active")}
            >
              Active{" "}
              <span className="tabular-nums opacity-70">
                ({activeAll.length})
              </span>
            </SegmentButton>
            <SegmentButton
              active={status === "expired"}
              onClick={() => setStatus("expired")}
            >
              Expired{" "}
              <span className="tabular-nums opacity-70">
                ({expiredAll.length})
              </span>
            </SegmentButton>
          </div>

          <Chip active={setAside === "all"} onClick={() => setSetAside("all")}>
            All
          </Chip>
          {setAsideOptions.map((option) => (
            <Chip
              key={option}
              active={setAside === option}
              onClick={() => setSetAside(option)}
            >
              {option}
            </Chip>
          ))}

          <button
            type="button"
            onClick={() => setSavedOnly((value) => !value)}
            aria-pressed={savedOnly}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              savedOnly
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            <Bookmark
              className={cn("h-3.5 w-3.5", savedOnly && "fill-current")}
            />
            Saved{count > 0 ? ` (${count})` : ""}
          </button>

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
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-4 sm:px-6">
        <p className="mb-3 text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "opportunity" : "opportunities"}
        </p>

        {visible.length === 0 ? (
          <EmptyState savedOnly={savedOnly} baseEmpty={baseEmpty} status={status} />
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
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn("h-4 w-4", tone)} />
        <span className="truncate text-xs font-medium">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
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
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground",
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
      className={cn(
        "rounded-md px-3 py-1 font-medium transition-colors",
        active
          ? "bg-secondary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Chip({
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
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EmptyState({
  savedOnly,
  baseEmpty,
  status,
}: {
  savedOnly: boolean;
  baseEmpty: boolean;
  status: Status;
}) {
  let title: string;
  let description: string;
  if (savedOnly) {
    title = "No saved opportunities";
    description = "Tap the bookmark on any card to save it here.";
  } else if (baseEmpty) {
    title = status === "active" ? "No active opportunities" : "No expired opportunities";
    description =
      status === "active"
        ? "New contracts will appear here as your agent finds them."
        : "Opportunities past their response deadline will collect here.";
  } else {
    title = "No matches";
    description = "Try a different search term, set-aside, or sort.";
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <SearchX className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
