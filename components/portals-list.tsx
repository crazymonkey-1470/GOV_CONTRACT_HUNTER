"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { ExternalLink, Link2, MapPin, Search, SearchX } from "lucide-react";

import { pill } from "@/components/bubbly";
import { formatDate, toStringArray } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SourcingPortal } from "@/lib/types";

/** Known portal types in display order; any other type sorts after these, before "other". */
const TYPE_ORDER = ["federal", "state", "county", "aggregator"];
const TYPE_LABELS: Record<string, string> = {
  federal: "Federal",
  state: "State",
  county: "County",
  aggregator: "Aggregators",
  other: "Other",
};

const chip =
  "inline-flex max-w-full items-center gap-1.5 rounded-full bg-cream-edge px-2.5 py-1 text-xs font-semibold text-ink/80";

function typeKey(portal: SourcingPortal) {
  return (portal.portal_type ?? "").trim().toLowerCase() || "other";
}

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function typeRank(type: string) {
  const index = TYPE_ORDER.indexOf(type);
  if (index !== -1) return index;
  return type === "other" ? TYPE_ORDER.length + 1 : TYPE_ORDER.length;
}

export function PortalsList({ portals }: { portals: SourcingPortal[] }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const filtered = portals.filter((portal) => {
      if (!q) return true;
      const haystack = [
        portal.name,
        portal.state,
        portal.notes,
        portal.portal_url,
        toStringArray(portal.search_keywords).join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

    const byType = new Map<string, SourcingPortal[]>();
    for (const portal of filtered) {
      const key = typeKey(portal);
      const list = byType.get(key) ?? [];
      list.push(portal);
      byType.set(key, list);
    }

    return Array.from(byType.entries())
      .map(([type, items]) => ({ type, items }))
      .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.type.localeCompare(b.type));
  }, [portals, q]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (portals.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="No links yet"
        description="Portals show up here once they're added to the database."
      />
    );
  }

  return (
    <div>
      <div className="relative mx-auto mt-5 max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/70"
        />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, state or keyword…"
          aria-label="Search portals"
          className="h-11 w-full rounded-full border-0 bg-cream pl-10 pr-4 text-base text-ink shadow-bubble sm:text-sm placeholder:text-ink/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun/60"
        />
      </div>

      <p className="sr-only" aria-live="polite">
        {q ? `${total} ${total === 1 ? "portal matches" : "portals match"} your search` : ""}
      </p>

      {total === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No matching portals"
          description="Try a different name, state or keyword."
        >
          <button
            type="button"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
            className={cn(pill.base, pill.sun, "mt-5")}
          >
            Clear search
          </button>
        </EmptyState>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((group) => {
            const headingId = `portals-${group.type.replace(/[^a-z0-9]+/g, "-")}`;
            const count = group.items.length;
            return (
              <section key={group.type} aria-labelledby={headingId}>
                <div className="mb-3 flex items-center gap-2">
                  <h2 id={headingId} className="font-display text-lg font-bold text-cream">
                    {typeLabel(group.type)}
                  </h2>
                  <span className="rounded-full bg-forest-deep px-2 py-0.5 text-xs font-bold tabular-nums text-sun">
                    {count}
                    <span className="sr-only">{count === 1 ? " portal" : " portals"}</span>
                  </span>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((portal) => (
                    <PortalCard key={portal.id} portal={portal} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PortalCard({ portal }: { portal: SourcingPortal }) {
  const keywords = toStringArray(portal.search_keywords).slice(0, 6);

  return (
    <article className="flex min-w-0 flex-col rounded-bubble bg-cream p-5 text-ink shadow-bubble">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 font-serif text-lg font-bold leading-snug">
          <a
            href={portal.portal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-start gap-1.5 rounded-md hover:underline focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-forest/30"
          >
            <span className="min-w-0 break-words">{portal.name}</span>
            <ExternalLink aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-forest" />
          </a>
        </h3>
        {portal.state ? (
          <span className={cn(chip, "max-w-[45%] shrink-0")}>
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-forest" />
            <span className="truncate">{portal.state}</span>
          </span>
        ) : null}
      </div>

      {portal.notes ? (
        <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-ink/75">
          {portal.notes}
        </p>
      ) : null}

      {keywords.length > 0 ? (
        <ul aria-label="Keywords" className="mt-3 flex flex-wrap gap-1.5">
          {keywords.map((keyword, index) => (
            <li key={`${keyword}-${index}`} className={chip}>
              <span className="truncate">{keyword}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {portal.last_checked ? (
        // last_checked is a timestamp: the server (UTC) and browser can land on different days.
        <p className="mt-3 text-xs text-ink/70" suppressHydrationWarning>
          Last checked {formatDate(portal.last_checked)}
        </p>
      ) : null}

      <div className="mt-auto pt-4">
        <a
          href={portal.portal_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Visit site: ${portal.name}`}
          className={cn(pill.base, pill.outline)}
        >
          Visit site
          <ExternalLink aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mt-6 flex flex-col items-center rounded-bubble bg-cream px-6 py-10 text-center text-ink shadow-bubble">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-cream-edge">
        <Icon aria-hidden="true" className="h-6 w-6 text-forest" />
      </div>
      <h2 className="mt-4 font-serif text-xl font-bold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-ink/75">{description}</p>
      {children}
    </div>
  );
}
