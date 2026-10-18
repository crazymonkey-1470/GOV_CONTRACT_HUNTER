"use client";

import { useEffect, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bookmark, LayoutGrid, Link2, LogOut } from "lucide-react";

import { signOut } from "@/app/auth/actions";
import { Wordmark, pill } from "@/components/bubbly";
import { useSaved } from "@/components/saved-provider";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/links", label: "Helpful links", icon: Link2 },
];

function navPill(active: boolean) {
  return cn(
    pill.base,
    "h-11 min-w-11 px-3 sm:px-4",
    active
      ? "bg-sun text-ink ring-4 ring-sun/30 hover:bg-sun-soft focus-visible:ring-sun/60"
      : "bg-forest-deep text-cream hover:bg-black/25 focus-visible:ring-sun/60",
  );
}

/** Top bar: stacked wordmark on the left, pill navigation on the right. */
export function AppHeader({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const { count, ready } = useSaved();
  const saved = ready ? count : 0;

  // A native "#saved" link leaves a history entry without Next's router state, and
  // Next ignores Back/Forward to such entries. Re-stamp it through Next's patched
  // replaceState so the router owns it again.
  useEffect(() => {
    const restamp = () => {
      const state: unknown = window.history.state;
      if (!(state && typeof state === "object" && "__NA" in state)) {
        window.history.replaceState(null, "", window.location.href);
      }
    };
    window.addEventListener("hashchange", restamp);
    return () => window.removeEventListener("hashchange", restamp);
  }, []);

  // Going "home" from /dashboard#saved must also turn the Saved filter off; a
  // same-page <Link> (pushState) would drop the hash without telling the dashboard.
  const leaveSaved = (event: MouseEvent) => {
    if (pathname !== "/dashboard" || window.location.hash !== "#saved") return;
    event.preventDefault();
    window.history.pushState(null, "", "/dashboard");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6 sm:pt-7">
      <Link
        href="/dashboard"
        onClick={leaveSaved}
        aria-label="ContractHunter dashboard"
        className="rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-sun/60"
      >
        <Wordmark className="text-[22px] sm:text-[30px]" />
      </Link>

      <nav aria-label="Main" className="flex items-center gap-1.5 sm:gap-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={item.href === "/dashboard" ? leaveSaved : undefined}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={navPill(active)}
            >
              <Icon />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}

        {pathname === "/dashboard" ? (
          // Already on the dashboard: a native hash link fires "hashchange",
          // which a Next <Link> (history.pushState) would not.
          <a
            href="#saved"
            aria-label={`Saved opportunities (${saved})`}
            className={navPill(false)}
          >
            <Bookmark />
            <span className="hidden sm:inline">Saved</span>
            {saved > 0 ? (
              <span className="rounded-full bg-sun px-1.5 text-xs font-bold tabular-nums text-ink">
                {saved}
              </span>
            ) : null}
          </a>
        ) : (
          <Link
            href="/dashboard#saved"
            aria-label={`Saved opportunities (${saved})`}
            className={navPill(false)}
          >
            <Bookmark />
            <span className="hidden sm:inline">Saved</span>
            {saved > 0 ? (
              <span className="rounded-full bg-sun px-1.5 text-xs font-bold tabular-nums text-ink">
                {saved}
              </span>
            ) : null}
          </Link>
        )}

        <form action={signOut}>
          <button
            type="submit"
            aria-label="Sign out"
            title={email ? `Signed in as ${email}` : undefined}
            className={navPill(false)}
          >
            <LogOut />
            <span className="hidden md:inline">Sign out</span>
          </button>
        </form>
      </nav>
    </header>
  );
}
