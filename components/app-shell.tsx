import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { SavedProvider } from "@/components/saved-provider";

/** App frame: navy page, top bar with pill navigation, and the saved-state provider. */
export function AppShell({
  email,
  children,
}: {
  email?: string | null;
  children: ReactNode;
}) {
  return (
    <SavedProvider>
      <div className="min-h-screen bg-forest">
        <AppHeader email={email} />
        <main className="min-w-0">{children}</main>
      </div>
    </SavedProvider>
  );
}
