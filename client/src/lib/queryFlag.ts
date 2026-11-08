/**
 * Read-once URL flags for deep links such as `/employees?add=1`, which open a
 * dialog straight from a dashboard shortcut. The flag is stripped from the
 * address bar as it's read, so a refresh or the Back button never reopens it.
 */
export function consumeQueryFlag(name: string): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get(name) !== "1") return false;
  url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url.toString());
  return true;
}
