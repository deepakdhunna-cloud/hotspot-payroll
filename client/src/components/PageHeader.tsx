/**
 * Shared page header. Hierarchy: brand speed-lines + red eyebrow set the
 * section, a condensed signage title carries the page, one muted line of
 * context below. Controls (week nav, store filter, CTA) sit right-aligned
 * and wrap under the title on narrow screens.
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
        "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between pb-5 border-b border-border",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="speed-lines shrink-0" aria-hidden="true">
            <i />
          </span>
          {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        </div>
        <h1 className="page-title mt-2">{title}</h1>
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
