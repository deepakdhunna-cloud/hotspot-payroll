/**
 * Light and dark mode.
 *
 * By default the site follows the device: light when the phone is light,
 * dark when the phone is dark, switching with it. Anyone can instead set it
 * by hand — Light or Dark — and it then stays that way on that device until
 * they pick Auto again. The choice is kept in localStorage under "theme"
 * ("light" | "dark"; nothing stored means "follow the device").
 *
 * index.html applies it before first paint so the page never flashes the
 * wrong theme; this provider keeps it in sync afterwards — when the switch
 * is used, when the device flips between day and night, and when another
 * tab changes it. Every change cross-fades instead of snapping.
 *
 * `theme` is what was chosen ("system" | "light" | "dark");
 * `resolvedTheme` is what is on screen ("light" | "dark").
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextType {
  /** What was chosen. "system" = follow the device. */
  theme: ThemePreference;
  /** What is on screen right now. */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
}

const STORAGE_KEY = "theme";
/** Page surface per theme — mirrored in index.html's theme-color metas. */
const CHROME_COLOR: Record<ResolvedTheme, string> = {
  light: "#ffffff",
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
    const forDark = (meta.getAttribute("media") ?? "").includes("dark");
    meta.setAttribute(
      "content",
      preference === "system" ? CHROME_COLOR[forDark ? "dark" : "light"] : CHROME_COLOR[resolved],
    );
  });
}

/**
 * Run a theme change as a short cross-fade: a view transition where the
 * browser has them, otherwise a brief CSS transition on colors (.theme-fade
 * in index.css). People who ask for reduced motion get an instant switch.
 */
function smoothly(update: () => void) {
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (calm) {
    update();
    return;
  }
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (doc.startViewTransition) {
    doc.startViewTransition(update);
    return;
  }
  const root = document.documentElement;
  root.classList.add("theme-fade");
  update();
  window.setTimeout(() => root.classList.remove("theme-fade"), 280);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readPreference);
  const [device, setDevice] = useState<ResolvedTheme>(deviceTheme);
  const resolvedTheme: ResolvedTheme = theme === "system" ? device : theme;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  // Follow the device when it flips between day and night.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      smoothly(() => {
        setDevice(next);
        if (themeRef.current === "system") paint("system", next);
      });
    };
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

  // Safety net: whatever changed, the page matches the state.
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
    smoothly(() => {
      setThemeState(next);
      paint(next, next === "system" ? deviceTheme() : next);
    });
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
