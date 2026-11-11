/**
 * Light and dark mode.
 *
 * The preference is "system" (follow the device, the default), "light" or
 * "dark", kept in localStorage under "theme". index.html applies it before
 * first paint so the page never flashes the wrong theme; this provider keeps
 * it in sync afterwards — when the manager picks a theme, when the device
 * switches between day and night, and when another tab changes it.
 *
 * `resolvedTheme` is what is actually on screen ("light" or "dark").
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  /** What the manager chose. */
  theme: ThemePreference;
  /** What is on screen right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
}

const STORAGE_KEY = "theme";
/** Page surface per theme — mirrored in index.html's theme-color metas. */
const CHROME_COLOR: Record<ResolvedTheme, string> = {
  light: "#f7f7f8",
  dark: "#0c0c0e",
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* storage unavailable — follow the device */
  }
  return "system";
}

function deviceTheme(): ResolvedTheme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function paint(preference: ThemePreference, resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  // Browser bars and the home-screen status area match the page surface.
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const media = meta.getAttribute("media") ?? "";
    const forDark = media.includes("dark");
    meta.setAttribute(
      "content",
      preference === "system" ? CHROME_COLOR[forDark ? "dark" : "light"] : CHROME_COLOR[resolved],
    );
  });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readPreference);
  const [device, setDevice] = useState<ResolvedTheme>(deviceTheme);
  const resolvedTheme: ResolvedTheme = theme === "system" ? device : theme;

  // Follow the device when it flips between day and night.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setDevice(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // A theme picked in another tab applies here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setThemeState(readPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    paint(theme, resolvedTheme);
  }, [theme, resolvedTheme]);

  const setTheme = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice lasts for this visit */
    }
    const apply = () => setThemeState(next);
    // Cross-fade the whole page where the browser can; otherwise just switch.
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => unknown;
    };
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !calm) {
      doc.startViewTransition(() => {
        apply();
        const resolved = next === "system" ? deviceTheme() : next;
        paint(next, resolved);
      });
    } else {
      apply();
    }
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
