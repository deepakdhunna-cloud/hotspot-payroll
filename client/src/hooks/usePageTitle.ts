import { useEffect } from "react";

const APP = "Hotspot Payroll";

/** Name the browser tab after the page ("Payroll · Hotspot Payroll"). */
export function usePageTitle(title?: string | null) {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
