/**
 * Branded empty state — the speed-lines motif instead of a bare gray
 * sentence, so even "nothing here" looks designed.
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  hint,
  className,
}: {
  title: string;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2.5 py-8 text-center", className)}>
      <span className="speed-lines opacity-40" aria-hidden="true">
        <i />
      </span>
      <p className="text-sm font-semibold text-foreground/80">{title}</p>
      {hint ? <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">{hint}</p> : null}
    </div>
  );
}
