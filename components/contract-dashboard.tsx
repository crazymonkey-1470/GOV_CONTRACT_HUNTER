"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Inbox, Search, SearchX, SlidersHorizontal } from "lucide-react";

import { ContractCard } from "@/components/contract-card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { getDeadlineInfo } from "@/lib/format";
import { MIN_RELEVANCE_SCORE, type Opportunity } from "@/lib/types";

type TabValue = "active" | "expired";

export function ContractDashboard({
  opportunities,
}: {
  opportunities: Opportunity[];
}) {
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(MIN_RELEVANCE_SCORE);
  const [tab, setTab] = useState<TabValue>("active");

  // Re-evaluate "expired" periodically so a long-open session reclassifies
  // opportunities (and refreshes the tab counts) as deadlines lapse.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { active, expired, totalActive, totalExpired } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const reference = new Date(now);

    const isExpired = (opportunity: Opportunity) =>
      getDeadlineInfo(opportunity.response_deadline, reference).status ===
      "expired";

    const matchesFilter = (opportunity: Opportunity) => {
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
    };

    const activeList: Opportunity[] = [];
    const expiredList: Opportunity[] = [];
    let activeCount = 0;
    let expiredCount = 0;

    for (const opportunity of opportunities) {
      // Only a deadline strictly in the past is "expired"; due-today and
      // no-deadline opportunities stay Active.
      const expiredItem = isExpired(opportunity);
      if (expiredItem) expiredCount += 1;
      else activeCount += 1;

      if (!matchesFilter(opportunity)) continue;
      (expiredItem ? expiredList : activeList).push(opportunity);
    }

    return {
      active: activeList,
      expired: expiredList,
      totalActive: activeCount,
      totalExpired: expiredCount,
    };
  }, [opportunities, query, minScore, now]);

  const noMatch = (
    <EmptyState
      icon={<SearchX className="h-8 w-8 text-muted-foreground" />}
      title="No matching opportunities"
      description="Try a different search term or lower the minimum relevance score."
    />
  );

  return (
    <div className="space-y-6">
      {/* Controls: search + minimum relevance slider (apply to both tabs) */}
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

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabValue)}>
        <TabsList>
          <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
          <TabsTrigger value="expired">Expired ({expired.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <OpportunityList
            opportunities={active}
            empty={
              opportunities.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-8 w-8 text-muted-foreground" />}
                  title="No opportunities yet"
                  description="High-relevance contracts will appear here as the agent discovers them."
                />
              ) : totalActive === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-8 w-8 text-muted-foreground" />}
                  title="No active opportunities"
                  description="Every current opportunity has expired — check the Expired tab."
                />
              ) : (
                noMatch
              )
            }
          />
        </TabsContent>

        <TabsContent value="expired">
          <OpportunityList
            opportunities={expired}
            empty={
              totalExpired === 0 ? (
                <EmptyState
                  icon={<SearchX className="h-8 w-8 text-muted-foreground" />}
                  title="No expired opportunities"
                  description="Opportunities whose response deadline has passed will appear here."
                />
              ) : (
                noMatch
              )
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OpportunityList({
  opportunities,
  empty,
}: {
  opportunities: Opportunity[];
  empty: ReactNode;
}) {
  if (opportunities.length === 0) return <>{empty}</>;

  return (
    <div className="grid gap-4">
      {opportunities.map((opportunity) => (
        <ContractCard key={opportunity.id} opportunity={opportunity} />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
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
