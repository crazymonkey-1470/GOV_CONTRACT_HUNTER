import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { DashboardView } from "@/components/dashboard-view";
import { createClient } from "@/lib/supabase/server";
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
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not load opportunities</p>
              <p className="mt-1 text-destructive/80">{error.message}</p>
            </div>
          </div>
        </div>
      ) : (
        <DashboardView opportunities={opportunities} />
      )}
    </AppShell>
  );
}
