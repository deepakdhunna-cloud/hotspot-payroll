import { Skeleton } from "./ui/skeleton";

/**
 * Loading shell that matches the real chrome — brand bar and tab bar on a
 * phone, rail or sidebar beside the content column on larger screens — so
 * nothing jumps when the session resolves.
 */
export function DashboardLayoutSkeleton() {
  return (
    <div className="app-shell" role="status" aria-label="Loading">
      <aside className="sidenav" aria-hidden="true">
        <Skeleton className="mx-auto h-8 w-10 rounded-lg xl:mx-0 xl:w-32" />
        <div className="mt-4 flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="mx-auto h-11 w-11 rounded-xl xl:mx-0 xl:h-9 xl:w-full" />
          ))}
        </div>
        <Skeleton className="mx-auto mt-auto h-9 w-9 rounded-full xl:mx-0 xl:h-12 xl:w-full xl:rounded-xl" />
      </aside>

      <div className="app-main">
        <header className="app-topbar" aria-hidden="true">
          <Skeleton className="mr-auto h-7 w-28 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="ml-2 mr-2 h-7 w-7 rounded-full" />
        </header>
        <main className="relative flex-1">
          <div className="app-page space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-8 w-64 rounded-lg" />
              <Skeleton className="h-4 w-44 rounded" />
            </div>
            <Skeleton className="h-36 w-full rounded-2xl" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-56 rounded-2xl" />
              <Skeleton className="h-56 rounded-2xl" />
            </div>
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </main>
      </div>
    </div>
  );
}
