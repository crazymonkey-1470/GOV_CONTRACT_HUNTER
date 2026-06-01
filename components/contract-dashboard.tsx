"use client";

import { useMemo, useState } from "react";
import { Inbox, Search, SearchX, SlidersHorizontal } from "lucide-react";

import { ContractCard } from "@/components/contract-card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { MIN_RELEVANCE_SCORE, type Opportunity } from "@/lib/types";

export function ContractDashboard({
  opportunities,
}: {
  opportunities: Opportunity[];
}) {
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(MIN_RELEVANCE_SCORE);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return opportunities.filter((opportunity) => {
      if (opportunity.relevance_score < minScore) return false;
      if (!q) return true;

      const haystack = [
        opportunity.title,
        opportunity.agency,
        opportunity.summary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [opportunities, query, minScore]);

  return (
    <div className="space-y-6">
      {/* Controls: search + minimum relevance slider */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, agency, or summary…"
            className="pl-9"
            aria-label="Search opportunities"
          />
        </div>

        <div className="flex items-center gap-3 sm:w-80">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Slider
            value={[minScore]}
            min={MIN_RELEVANCE_SCORE}
            max={100}
            step={1}
            onValueChange={(values) => setMinScore(values[0])}
            aria-label="Minimum relevance score"
          />
          <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-muted-foreground">
            ≥ {minScore}
          </span>
        </div>
      </div>

      {/* Result count */}
      <p className="text-sm text-muted-foreground">
        Showing <span className="font-medium text-foreground">{filtered.length}</span>{" "}
        {filtered.length === 1 ? "opportunity" : "opportunities"}
      </p>

      {/* List / empty states */}
      {filtered.length === 0 ? (
        opportunities.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8 text-muted-foreground" />}
            title="No opportunities yet"
            description="High-relevance contracts will appear here as the agent discovers them."
          />
        ) : (
          <EmptyState
            icon={<SearchX className="h-8 w-8 text-muted-foreground" />}
            title="No matching opportunities"
            description="Try a different search term or lower the minimum relevance score."
          />
        )
      ) : (
        <div className="grid gap-4">
          {filtered.map((opportunity) => (
            <ContractCard key={opportunity.id} opportunity={opportunity} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-card/50 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        {icon}
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
