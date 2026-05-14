/**
 * Shared page header used across every screen in the manager app.
 *
 * Layout: small eyebrow / large title / one-line description on the left,
 * action slot (week navigator, store filter, primary CTA, etc.) on the right.
 * Wraps gracefully on narrow screens.
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  icon,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 md:flex-row md:items-end md:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title flex items-center gap-2 leading-tight">
          {icon ? (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {icon}
            </span>
          ) : null}
          <span>{title}</span>
        </h1>
        {description ? <p className="page-subtitle">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
