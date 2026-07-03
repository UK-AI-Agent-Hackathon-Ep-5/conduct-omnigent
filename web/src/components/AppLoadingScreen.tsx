import { Spinner } from "@/components/ui/spinner";

const loadingPhases = [
  { label: "Server", className: "bg-brand-accent" },
  { label: "Sessions", className: "bg-status-blue" },
  { label: "Workspace", className: "bg-status-green" },
] as const;

export function AppLoadingScreen() {
  return (
    <main
      aria-busy="true"
      className="app-shell flex min-h-dvh w-full items-center justify-center overflow-hidden px-6 py-10 text-foreground"
    >
      <section
        aria-live="polite"
        className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
      >
        <div className="relative flex size-20 items-center justify-center rounded-lg border border-border bg-card shadow-sm">
          <div className="absolute inset-3 rounded-md bg-brand-accent/10" />
          <Spinner className="relative size-7 text-brand-accent" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Preparing workspace</h1>
          <p className="mx-auto max-w-72 text-sm leading-6 text-muted-foreground">
            Connecting to the server and restoring your session.
          </p>
        </div>

        <div className="grid w-full grid-cols-3 gap-2" aria-hidden="true">
          {loadingPhases.map((phase) => (
            <div
              key={phase.label}
              className="flex min-w-0 items-center justify-center gap-2 rounded-md border border-border bg-card/70 px-2 py-2 text-xs text-muted-foreground"
            >
              <span className={`size-1.5 shrink-0 rounded-full ${phase.className}`} />
              <span className="truncate">{phase.label}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
