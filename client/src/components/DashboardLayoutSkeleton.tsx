import { Skeleton } from "./ui/skeleton";

/**
 * Loading shell that matches the real chrome exactly — the floating glass
 * top bar and the centered content column — so nothing jumps when the
 * session resolves.
 */
export function DashboardLayoutSkeleton() {
  return (
    <div className="min-h-svh flex flex-col" role="status" aria-label="Loading">
      <header className="sticky top-0 z-50 px-2 pt-2 sm:px-3 sm:pt-3">
        <div className="topbar mx-auto flex h-14 max-w-[1400px] items-center gap-2 rounded-2xl px-3 lg:px-4">
          <Skeleton className="h-7 w-28 rounded-md bg-white/10 sm:h-8 sm:w-32" />
          <div className="hidden md:flex items-center gap-2 ml-3 lg:ml-5">
            <Skeleton className="h-8 w-24 rounded-lg bg-white/10" />
            <Skeleton className="h-8 w-24 rounded-lg bg-white/[0.07]" />
            <Skeleton className="h-8 w-20 rounded-lg bg-white/[0.07]" />
            <Skeleton className="h-8 w-20 rounded-lg bg-white/[0.07]" />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Skeleton className="h-8 w-8 rounded-lg bg-white/[0.07]" />
            <Skeleton className="h-8 w-8 rounded-lg bg-white/[0.07]" />
            <Skeleton className="h-7 w-7 rounded-full bg-white/10" />
          </div>
        </div>
      </header>

      <main className="relative flex-1">
        <div className="relative mx-auto w-full max-w-[1180px] px-4 md:px-6 pt-6 md:pt-8 pb-24 md:pb-10 space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 rounded-lg" />
            <Skeleton className="h-4 w-44 rounded" />
          </div>
          <Skeleton className="h-28 w-full rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </main>
    </div>
  );
}
