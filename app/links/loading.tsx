import { AppShell } from "@/components/app-shell";
import { cn } from "@/lib/utils";

const block = "rounded-bubble bg-cream/15 motion-safe:animate-pulse";

export default function LinksLoading() {
  return (
    <AppShell>
      <div aria-busy="true" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <span className="sr-only" role="status">
          Loading links…
        </span>
        <div aria-hidden="true">
          <div className={cn(block, "mx-auto h-6 w-48 rounded-full")} />
          <div className={cn(block, "mx-auto mt-2 h-4 w-full max-w-xs rounded-full")} />
          <div className={cn(block, "mt-6 h-11 w-full max-w-md rounded-full")} />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cn(block, "h-36")} />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
