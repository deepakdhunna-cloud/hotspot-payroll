/**
 * One async-state language for every table and data block:
 * skeleton rows while loading, a branded empty state, and a real
 * error state with retry — so a failed query never masquerades as
 * an empty success.
 */
import { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { TableCell, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";

interface StateProps {
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyHint?: ReactNode;
}

function ErrorBlock({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <AlertTriangle className="h-6 w-6 text-warning" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">Couldn&apos;t load this data</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Check your connection, then try again.
        </p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="bg-card">
          <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Drop inside a <TableBody>. Renders skeleton rows / error / empty as
 * full-width rows; renders nothing when the table has data.
 */
export function TableStateRows({
  colSpan,
  skeletonRows = 4,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle = "Nothing here yet",
  emptyHint,
}: StateProps & { colSpan: number; skeletonRows?: number }) {
  if (isLoading) {
    return (
      <>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <TableRow key={i} className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="py-3">
              <Skeleton className="h-5 w-full" style={{ maxWidth: `${88 - i * 9}%` }} />
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  }
  if (isError) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan}>
          <ErrorBlock onRetry={onRetry} />
        </TableCell>
      </TableRow>
    );
  }
  if (isEmpty) {
    return (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={colSpan}>
          <EmptyState title={emptyTitle} hint={emptyHint} />
        </TableCell>
      </TableRow>
    );
  }
  return null;
}

/**
 * Same three states for non-table blocks (charts, card grids).
 * Renders children when the data is ready.
 */
export function BlockState({
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle = "Nothing here yet",
  emptyHint,
  skeletonClassName = "h-40",
  children,
}: StateProps & { skeletonClassName?: string; children: ReactNode }) {
  if (isLoading) return <Skeleton className={`w-full ${skeletonClassName}`} />;
  if (isError) return <ErrorBlock onRetry={onRetry} />;
  if (isEmpty) return <EmptyState title={emptyTitle} hint={emptyHint} />;
  return <>{children}</>;
}
