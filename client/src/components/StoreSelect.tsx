/**
 * Scope-aware store filter used identically on every page:
 *  - CEO or multi-store manager: dropdown with an "All stores" option
 *  - single-store manager: a static badge (their store; nothing to choose)
 * In the app chrome (tone="ink") the trigger is compact — store
 * abbreviations, and just "All" on phones — so the bar never overflows.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STORE_ABBR } from "@/lib/format";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function StoreSelect({
  stores,
  isAdmin,
  value,
  onChange,
  className,
  tone = "card",
}: {
  stores: string[];
  isAdmin: boolean;
  value: string; // "all" or a store name
  onChange: (next: string) => void;
  className?: string;
  /** "card" on pages, "ink" for the compact form in the app chrome */
  tone?: "card" | "ink";
}) {
  const canPickAll = isAdmin || stores.length > 1;
  const allLabel = isAdmin ? "All stores" : "All my stores";
  const ink = tone === "ink";

  if (!canPickAll && stores.length === 1) {
    return (
      <span
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium",
          ink ? "border-border bg-transparent" : "border-border bg-card shadow-sm",
          className,
        )}
        aria-label={`Store: ${stores[0]}`}
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {STORE_ABBR[stores[0]] ?? stores[0]}
      </span>
    );
  }

  const selectedName = value === "all" ? allLabel : value;
  const short = value === "all" ? null : (STORE_ABBR[value] ?? value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          "text-sm",
          ink ? "h-9 gap-1.5 px-2.5 shadow-none" : "h-8 w-44 bg-card shadow-sm",
          className,
        )}
        aria-label={`Store: ${selectedName}`}
        title={ink ? `Showing ${selectedName}` : undefined}
      >
        {ink ? (
          <SelectValue placeholder="Store">
            <span className="flex min-w-0 items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {short ? (
                <span className="truncate">{short}</span>
              ) : (
                <>
                  <span className="sm:hidden">All</span>
                  <span className="hidden truncate sm:inline">{allLabel}</span>
                </>
              )}
            </span>
          </SelectValue>
        ) : (
          <SelectValue placeholder="Store" />
        )}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
