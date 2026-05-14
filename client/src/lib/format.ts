export const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export const fmtHours = (n: number) =>
  `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} h`;

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

export const STORE_COLORS: Record<string, string> = {
  "Hotspot Market 11": "from-red-500/30 to-red-500/5",
  "Hotspot Market 13": "from-orange-500/30 to-orange-500/5",
  "Hotspot Market 14": "from-amber-500/30 to-amber-500/5",
  "Hotspot Travel Center": "from-rose-500/30 to-rose-500/5",
};

export const STORE_ABBR: Record<string, string> = {
  "Hotspot Market 11": "HM 11",
  "Hotspot Market 13": "HM 13",
  "Hotspot Market 14": "HM 14",
  "Hotspot Travel Center": "Travel",
};
