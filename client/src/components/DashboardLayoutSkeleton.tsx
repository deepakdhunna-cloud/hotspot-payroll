import { Skeleton } from "./ui/skeleton";

/** Loading shell matching the v3 chrome: ink top bar + centered column. */
export function DashboardLayoutSkeleton() {
  return (
    <div className="min-h-svh flex flex-col bg-background">
      {/* Top bar skeleton */}
      <div className="ink-panel h-14 flex items-center gap-4 px-4 lg:px-6">
        <Skeleton className="h-7 w-32 rounded-md bg-white/10" />
        <div className="hidden md:flex items-center gap-4 ml-4">
          <Skeleton className="h-4 w-20 rounded bg-white/10" />
          <Skeleton className="h-4 w-20 rounded bg-white/10" />
          <Skeleton className="h-4 w-16 rounded bg-white/10" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full bg-white/10 ml-auto" />
      </div>

      {/* Content skeleton */}
      <div className="mx-auto w-full max-w-[1180px] px-4 md:px-6 py-8 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24 rounded" />
          <Skeleton className="h-9 w-64 rounded-lg" />
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}
