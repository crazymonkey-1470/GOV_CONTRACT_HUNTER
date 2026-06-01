import { MainNav } from "@/components/main-nav";
import { SignOutButton } from "@/components/sign-out-button";

export function AppHeader({ email }: { email?: string | null }) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6">
        <span className="shrink-0 font-semibold tracking-tight">
          ContractHunter
        </span>
        <MainNav />
        <div className="ml-auto flex items-center gap-3">
          {email ? (
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
          ) : null}
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
