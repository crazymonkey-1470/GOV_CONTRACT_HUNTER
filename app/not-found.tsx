import Link from "next/link";

import { Wordmark, pill } from "@/components/bubbly";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-forest p-6 text-center">
      <Wordmark className="text-[34px]" />
      <div>
        <p className="font-display text-lg font-bold text-sun">404</p>
        <h1 className="mt-1 font-serif text-2xl font-bold text-cream">Page not found</h1>
      </div>
      <p className="max-w-md text-sm text-cream/80">That page doesn&apos;t exist.</p>
      <Link
        href="/dashboard"
        className={cn(pill.base, pill.sun, "focus-visible:ring-sun/60")}
      >
        Back to dashboard
      </Link>
    </main>
  );
}
