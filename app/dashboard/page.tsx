import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { pill } from "@/components/bubbly";
import { DashboardView } from "@/components/dashboard-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { MIN_RELEVANCE_SCORE, type Opportunity } from "@/lib/types";

// Reads auth cookies and live data, so always render on request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard · ContractHunter",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("contract_opportunities")
    .select("*")
    .gte("relevance_score", MIN_RELEVANCE_SCORE)
    .order("relevance_score", { ascending: false });

  const opportunities = (data ?? []) as Opportunity[];

  return (
    <AppShell email={user.email}>
      {error ? (
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <div
            role="alert"
            className="flex items-start gap-3 rounded-bubble bg-cream p-5 text-ink shadow-bubble"
          >
            <AlertTriangle aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-ember-ink" />
            <div className="min-w-0">
              <h1 className="font-serif text-lg font-bold">Couldn&apos;t load opportunities</h1>
              <p className="mt-1 text-sm text-ink/75 [overflow-wrap:anywhere]">{error.message}</p>
              <a href="/dashboard" className={cn(pill.base, pill.sun, "mt-4")}>
                Try again
              </a>
            </div>
          </div>
        </div>
      ) : (
        <DashboardView opportunities={opportunities} />
      )}
    </AppShell>
  );
}
