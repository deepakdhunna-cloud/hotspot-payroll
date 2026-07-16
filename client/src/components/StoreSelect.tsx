/**
 * Scope-aware store filter used identically on every page:
 *  - CEO or multi-store manager: dropdown with an "All stores" option
 *  - single-store manager: a static badge (their store; nothing to choose)
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
}: {
  stores: string[];
  isAdmin: boolean;
  value: string; // "all" or a store name
  onChange: (next: string) => void;
  className?: string;
}) {
  const canPickAll = isAdmin || stores.length > 1;

  if (!canPickAll && stores.length === 1) {
    return (
      <span
        className={cn(
          "inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm",
          className,
        )}
      >
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        {STORE_ABBR[stores[0]] ?? stores[0]}
      </span>
    );
  }

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 w-44 bg-card shadow-sm", className)}>
        <SelectValue placeholder="Store" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{isAdmin ? "All stores" : "All my stores"}</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s} value={s}>
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
