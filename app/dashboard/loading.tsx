import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

const block = "rounded-bubble bg-cream/15 motion-safe:animate-pulse";

export default function DashboardLoading() {
  return (
    <AppShell>
      <div aria-busy="true" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <span className="sr-only" role="status">
          Loading opportunities…
        </span>
        <div aria-hidden="true">
          <div className={cn(block, "mx-auto h-6 w-56 rounded-full")} />
          <div className={cn(block, "mx-auto mt-2 h-4 w-40 rounded-full")} />
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className={cn(block, "h-20 sm:h-24")} />
            ))}
          </div>
          <div className={cn(block, "mt-4 h-36 sm:h-28")} />
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cn(block, "h-72")} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
