import type { Metadata } from "next";

import { Wordmark } from "@/components/bubbly";
import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = {
  title: "Sign in · ContractHunter",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-forest px-4 py-10">
      <Wordmark className="text-center text-[48px] sm:text-[60px]" />

      <div className="mt-8 w-full max-w-sm rounded-bubble bg-cream p-6 text-ink shadow-bubble sm:p-8">
        <h1 className="font-serif text-3xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-ink/75">
          Use your ContractHunter username and password.
        </p>

        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
