import type { ReactNode } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { SavedProvider } from "@/components/saved-provider";

/** App frame: persistent sidebar + main content, with the saved-state provider. */
export function AppShell({
  email,
  children,
}: {
  email?: string | null;
  children: ReactNode;
}) {
  return (
    <SavedProvider>
      <div className="min-h-screen bg-muted/30 md:flex">
        <AppSidebar email={email} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </SavedProvider>
  );
}
