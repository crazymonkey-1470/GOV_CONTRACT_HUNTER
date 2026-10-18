import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { SectionHeading } from "@/components/bubbly";
import { PortalsList } from "@/components/portals-list";
import { createClient } from "@/lib/supabase/server";
import type { SourcingPortal } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Helpful links · ContractHunter",
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
        <SectionHeading>Helpful links</SectionHeading>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-cream/80">
          Contracting portals you can search yourself: federal, state, county and
          aggregators.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-bubble bg-cream p-5 text-ink shadow-bubble"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-1 h-5 w-5 shrink-0 text-ember-ink"
            />
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-bold">
                Couldn&apos;t load links
              </h2>
              <p className="mt-1 break-words text-sm text-ink/75">
                {error.message}
              </p>
            </div>
          </div>
        ) : (
          <PortalsList portals={portals} />
        )}
      </div>
    </AppShell>
  );
}
