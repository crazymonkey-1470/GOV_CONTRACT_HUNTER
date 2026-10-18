"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { Wordmark, pill } from "@/components/bubbly";
import { cn } from "@/lib/utils";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in server/browser logs for debugging.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-forest p-6 text-center">
      <Wordmark className="text-[34px]" />
      <h1 className="font-serif text-2xl font-bold text-cream">Something went wrong</h1>
      <p className="max-w-md text-sm text-cream/80 [overflow-wrap:anywhere]">
        {error.message || "Please try again."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className={cn(pill.base, pill.sun, "focus-visible:ring-sun/60")}
        >
          <RotateCcw aria-hidden="true" />
          Try again
        </button>
        <Link
          href="/dashboard"
          className={cn(pill.base, pill.sun, "focus-visible:ring-sun/60")}
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
