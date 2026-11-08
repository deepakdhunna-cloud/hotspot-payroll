import { STORES } from "@shared/hotspot";
export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtDate = (d: Date | string) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
};

export const fmtWeekRange = (weekStart: Date | string) => {
  const start = typeof weekStart === "string" ? new Date(weekStart) : weekStart;
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const opt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  return `${start.toLocaleDateString("en-US", opt)} – ${end.toLocaleDateString("en-US", opt)}`;
};

/**
 * Each store keeps one color everywhere (store cards, chart stacks, chips),
 * matching the order the Finance chart has always used.
 */
export function storeColor(store: string): string {
  const i = (STORES as readonly string[]).indexOf(store);
  return `var(--chart-${(i < 0 ? 0 : i % 5) + 1})`;
}

export const STORE_ABBR: Record<string, string> = {
  "Hotspot Market 11": "HM 11",
  "Hotspot Market 13": "HM 13",
  "Hotspot Market 14": "HM 14",
  "Hotspot Market 17": "HM 17",
  "Hotspot Travel Center": "Travel",
};


/**
 * Hours as a plain number with thousands separators ("1,695.0"). Callers add
 * the unit ("h") where a column header doesn't already say it.
 */
export function fmtHours(hours: number, digits = 1): string {
  const n = Number.isFinite(hours) ? hours : 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Hours with the unit, for prose and chips where no header says "hours":
 * "38.5 h" (no-break space, so the unit never wraps away from the number). */
export function fmtHoursLabel(hours: number, digits = 1): string {
  return `${fmtHours(hours, digits)} h`;
}
