import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { PortalsList } from "@/components/portals-list";
import { createClient } from "@/lib/supabase/server";
import type { SourcingPortal } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Helpful Links · ContractHunter",
};

export default async function LinksPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("sourcing_portals")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const portals = (data ?? []) as SourcingPortal[];

  return (
    <AppShell email={user.email}>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Helpful Links</h1>
          <p className="text-sm text-muted-foreground">
            Government contracting portals you can search directly — federal,
            state, and county.
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Could not load links</p>
              <p className="mt-1 text-destructive/80">{error.message}</p>
            </div>
          </div>
        ) : (
          <PortalsList portals={portals} />
        )}
      </div>
    </AppShell>
  );
}
