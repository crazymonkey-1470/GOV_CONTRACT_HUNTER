"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";

import { login } from "@/app/login/actions";
import { pill } from "@/components/bubbly";
import { cn } from "@/lib/utils";

const labelClass = "block font-display text-sm font-semibold text-ink";

// House text input on cream, taller with 16px text so iOS doesn't zoom on focus.
const inputClass =
  "h-12 w-full rounded-full border-2 border-cream-edge bg-white/80 px-5 text-base text-ink placeholder:text-ink/50 focus-visible:outline-none focus-visible:border-forest/40 focus-visible:ring-4 focus-visible:ring-forest/30";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      // Pending is the only disabled state; keep "Signing in…" readable.
      className={cn(pill.base, pill.sun, "h-12 w-full text-base disabled:opacity-75")}
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />
          Signing in…
        </>
      ) : (
        "Sign in"
      )}
    </button>
  );
}

export function LoginForm() {
  const [state, formAction] = useActionState(login, {});

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="username" className={labelClass}>
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="hello"
          required
          className={inputClass}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className={labelClass}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          className={inputClass}
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 text-sm font-semibold text-ember-ink"
        >
          <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          {state.error}
        </p>
      )}

      <div className="pt-2">
        <SubmitButton />
      </div>
    </form>
  );
}
