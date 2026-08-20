import { STORES, type Store } from "../../../shared/hotspot";

const KIOSK_STORE_KEY = "hotspot-kiosk-store";

function isStore(value: string | null): value is Store {
  return !!value && (STORES as readonly string[]).includes(value);
}

/**
 * Reads the store assigned to this browser's kiosk. Storage access is guarded
 * because locked-down tablet webviews can forbid localStorage.
 */
export function getKioskStore(): Store | null {
  try {
    const value = window.localStorage.getItem(KIOSK_STORE_KEY);
    return isStore(value) ? value : null;
  } catch {
    return null;
  }
}

/** Persists the only store this kiosk browser is allowed to use. */
export function lockKioskToStore(store: Store): void {
  try {
    window.localStorage.setItem(KIOSK_STORE_KEY, store);
  } catch {
    // The page remains usable with server-side employee/store enforcement.
  }
}

export function kioskPath(store: Store): string {
  return `/clock/${encodeURIComponent(store)}`;
}
