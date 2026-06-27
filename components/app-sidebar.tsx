"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, Crosshair, LayoutGrid, Link2, LogOut } from "lucide-react";

import { signOut } from "@/app/auth/actions";
import { useSaved } from "@/components/saved-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/links", label: "Helpful Links", icon: Link2 },
];

export function AppSidebar({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const { count, ready } = useSaved();

  return (
    <aside className="sticky top-0 z-30 border-b bg-card md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-3 md:h-full md:flex-col md:items-stretch md:gap-6 md:px-3 md:py-5">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 font-semibold tracking-tight md:px-2"
        >
          <Crosshair className="h-5 w-5 text-primary" />
          <span>ContractHunter</span>
        </Link>

        <nav className="flex items-center gap-1 md:flex-col md:items-stretch">
          {NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden md:inline">{item.label}</span>
              </Link>
            );
          })}

          <div className="ml-1 hidden items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground md:flex">
            <Bookmark className="h-4 w-4 shrink-0" />
            <span>Saved</span>
            <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums">
              {ready ? count : 0}
            </span>
          </div>
        </nav>

        <div className="flex items-center gap-2 md:mt-auto md:flex-col md:items-stretch md:gap-2 md:border-t md:pt-4">
          <span className="hidden truncate text-xs text-muted-foreground md:block md:px-2">
            {email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="hidden md:inline">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
