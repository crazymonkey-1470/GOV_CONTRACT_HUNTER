import {
  Building2,
  CalendarClock,
  DollarSign,
  ExternalLink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RelevanceBadge } from "@/components/relevance-badge";
import {
  formatCurrency,
  formatDate,
  getDeadlineInfo,
  toStringArray,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Opportunity } from "@/lib/types";

const deadlineColor: Record<string, string> = {
  ok: "text-muted-foreground",
  soon: "text-orange-600",
  expired: "text-destructive",
  none: "text-muted-foreground",
};

export function ContractCard({ opportunity }: { opportunity: Opportunity }) {
  const deadline = getDeadlineInfo(opportunity.response_deadline);
  const keywords = toStringArray(opportunity.keywords).slice(0, 6);
  const hasDeadlineDate = deadline.status === "ok" || deadline.status === "soon";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex gap-4 p-5">
        <RelevanceBadge score={opportunity.relevance_score} />

        <div className="min-w-0 flex-1">
          {/* Title — links out to SAM.gov in a new tab */}
          {opportunity.sam_link ? (
            <a
              href={opportunity.sam_link}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-start gap-1.5 text-base font-semibold leading-snug text-foreground hover:text-primary hover:underline"
            >
              <span className="break-words">{opportunity.title}</span>
              <ExternalLink className="mt-1 h-4 w-4 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
            </a>
          ) : (
            <h2 className="text-base font-semibold leading-snug text-foreground">
              {opportunity.title}
            </h2>
          )}

          {/* Meta row: agency · value · deadline */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
            {opportunity.agency && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Building2 className="h-4 w-4 shrink-0" />
                <span className="break-words">{opportunity.agency}</span>
              </span>
            )}

            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="h-4 w-4 shrink-0" />
              {formatCurrency(opportunity.value)}
            </span>

            <span
              className={cn(
                "inline-flex items-center gap-1.5 font-medium",
                deadlineColor[deadline.status],
              )}
            >
              <CalendarClock className="h-4 w-4 shrink-0" />
              {deadline.label}
              {hasDeadlineDate && (
                <span className="font-normal text-muted-foreground">
                  · {formatDate(opportunity.response_deadline)}
                </span>
              )}
            </span>
          </div>

          {/* Summary */}
          {opportunity.summary && (
            <p className="mt-3 text-sm leading-relaxed text-foreground/80">
              {opportunity.summary}
            </p>
          )}

          {/* Tags: set-aside + keywords */}
          {(opportunity.set_aside || keywords.length > 0) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {opportunity.set_aside && (
                <Badge variant="secondary">{opportunity.set_aside}</Badge>
              )}
              {keywords.map((keyword) => (
                <Badge key={keyword} variant="outline">
                  {keyword}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
