/**
 * Empty state: a quiet icon, one line saying what's missing, and (optionally)
 * the one action that fills it.
 */
import { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  title,
  hint,
  icon,
  action,
  className,
}: {
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
      <span
        className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&>svg]:h-5 [&>svg]:w-5"
        aria-hidden="true"
      >
        {icon ?? <Inbox />}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint ? (
        <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">{hint}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
