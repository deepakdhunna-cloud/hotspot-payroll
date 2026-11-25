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

/** A calendar day marker (00:00 UTC) as "Wed Nov 25". */
export const fmtDayShort = (day: Date | string) =>
  new Date(day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** A calendar day marker's weekday: "Wednesday". */
export const fmtWeekday = (day: Date | string) =>
  new Date(day).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * The days a payroll pays, "Nov 19 – Nov 24" — the same style as
 * fmtWeekRange, which it equals for a normal Thursday → Wednesday week.
 */
export const fmtDayRange = (firstDay: Date | string, lastDay: Date | string) => {
  const opt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const a = new Date(firstDay).toLocaleDateString("en-US", opt);
  const b = new Date(lastDay).toLocaleDateString("en-US", opt);
  return a === b ? a : `${a} – ${b}`;
};

/** The days moved out of a payroll, "Wed Nov 25" or "Tue Nov 24 – Wed Nov 25". */
export const fmtDaySpan = (from: Date | string, to: Date | string) => {
  const a = fmtDayShort(from);
  const b = fmtDayShort(to);
  return a === b ? a : `${a} – ${b}`;
};

/**
 * The stores, in display order. Starts as the built-in list and is replaced
 * by the server's list (which includes stores the CEO has added) as soon as
 * the app has it — see `registerStores`.
 */
let storeOrder: string[] = [...STORES];

/** Position of a store in the display order (unknown stores sort last). */
export function storeIndex(store: string): number {
  const i = storeOrder.indexOf(store);
  return i < 0 ? 99 : i;
}

/**
 * Each store keeps one color everywhere (store cards, chart stacks, chips),
 * matching the order the Finance chart has always used.
 */
export function storeColor(store: string): string {
  const i = storeOrder.indexOf(store);
  return `var(--chart-${(i < 0 ? 0 : i % 8) + 1})`;
}

/** Short store labels for chips and tight places. Filled by `registerStores`. */
export const STORE_ABBR: Record<string, string> = {
  "Hotspot Market 11": "HM 11",
  "Hotspot Market 13": "HM 13",
  "Hotspot Market 14": "HM 14",
  "Hotspot Market 17": "HM 17",
  "Hotspot Travel Center": "Travel",
};

/**
 * Take the server's store list (names and short labels, in order). Returns
 * true when something actually changed, so the caller can re-render pages
 * that had already read the old list.
 */
export function registerStores(info: { name: string; short: string }[]): boolean {
  if (info.length === 0) return false;
  const names = info.map((i) => i.name);
  let changed =
    names.length !== storeOrder.length || names.some((n, i) => n !== storeOrder[i]);
  for (const i of info) {
    if (STORE_ABBR[i.name] !== i.short) {
      STORE_ABBR[i.name] = i.short;
      changed = true;
    }
  }
  storeOrder = names;
  return changed;
}


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
