"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Link as LinkIcon, Search, SearchX } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, toStringArray } from "@/lib/format";
import type { SourcingPortal } from "@/lib/types";

const TYPE_ORDER = ["federal", "state", "county", "aggregator", "other"];
const TYPE_LABELS: Record<string, string> = {
  federal: "Federal",
  state: "State",
  county: "County",
  aggregator: "Aggregators",
  other: "Other",
};

function typeLabel(type: string) {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}

function typeRank(type: string) {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

export function PortalsList({ portals }: { portals: SourcingPortal[] }) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();

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
      const key = (portal.portal_type ?? "other").toLowerCase();
      const list = byType.get(key) ?? [];
      list.push(portal);
      byType.set(key, list);
    }

    return Array.from(byType.entries())
      .map(([type, items]) => ({ type, items }))
      .sort((a, b) => typeRank(a.type) - typeRank(b.type));
  }, [portals, query]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search portals by name, state, or keyword…"
          className="pl-9"
          aria-label="Search portals"
        />
      </div>

      {portals.length === 0 ? (
        <EmptyState
          title="No links yet"
          description="Contracting portals will appear here as they're added to the database."
        />
      ) : total === 0 ? (
        <EmptyState
          searchIcon
          title="No matching portals"
          description="Try a different search term."
        />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.type}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {typeLabel(group.type)}{" "}
                <span className="text-muted-foreground/60">
                  ({group.items.length})
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.items.map((portal) => (
                  <PortalCard key={portal.id} portal={portal} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalCard({ portal }: { portal: SourcingPortal }) {
  const keywords = toStringArray(portal.search_keywords).slice(0, 6);

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <a
            href={portal.portal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1.5 font-medium text-foreground hover:text-primary hover:underline"
          >
            <span className="break-words">{portal.name}</span>
            <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
          </a>
          {portal.state ? (
            <Badge variant="secondary" className="shrink-0">
              {portal.state}
            </Badge>
          ) : null}
        </div>

        {portal.notes ? (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {portal.notes}
          </p>
        ) : null}

        {keywords.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {keywords.map((keyword) => (
              <Badge key={keyword} variant="outline">
                {keyword}
              </Badge>
            ))}
          </div>
        ) : null}

        {portal.last_checked ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Last checked {formatDate(portal.last_checked)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  searchIcon,
}: {
  title: string;
  description: string;
  searchIcon?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        {searchIcon ? (
          <SearchX className="h-6 w-6 text-muted-foreground" />
        ) : (
          <LinkIcon className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
