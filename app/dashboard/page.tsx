import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { ContractDashboard } from "@/components/contract-dashboard";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";
import { MIN_RELEVANCE_SCORE, type Opportunity } from "@/lib/types";

// This page reads auth cookies and live data, so always render on request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard · ContractHunter",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defense-in-depth: middleware already guards this route.
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("contract_opportunities")
    .select("*")
    .gte("relevance_score", MIN_RELEVANCE_SCORE)
    .order("relevance_score", { ascending: false });

  const opportunities = (data ?? []) as Opportunity[];

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              Contract Opportunities
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Signed in as {user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not load opportunities</p>
              <p className="mt-1 text-destructive/80">{error.message}</p>
            </div>
          </div>
        ) : (
          <ContractDashboard opportunities={opportunities} />
        )}
      </main>
    </div>
  );
}
