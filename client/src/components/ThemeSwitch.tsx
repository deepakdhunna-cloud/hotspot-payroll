/**
 * The appearance switch. It lives in plain sight in the app chrome — never
 * inside the account menu:
 *
 *  - `ThemeSwitch` — the three choices side by side: Auto (follow this
 *    device), Light, Dark. Shown as-is in the desktop sidebar.
 *  - `ThemeMenu` — one button (sun in light, moon in dark) that opens those
 *    same three choices. Used where space is tight: the phone brand bar,
 *    the navigation rail and the sign-in screen.
 *
 * Picking a choice applies at once with a short cross-fade; the menu stays
 * open so the others can be tried.
 */
import { Moon, Sun, SunMoon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTheme, type ThemePreference } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun; title: string }[] = [
  { value: "system", label: "Auto", icon: SunMoon, title: "Follow this device" },
  { value: "light", label: "Light", icon: Sun, title: "Always light" },
  { value: "dark", label: "Dark", icon: Moon, title: "Always dark" },
];

export function ThemeSwitch({
  className,
  size = "sm",
}: {
  className?: string;
  /** "md" gives finger-sized segments (inside the menu on phones). */
  size?: "sm" | "md";
}) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn("sk-track grid grid-cols-3 gap-0.5 rounded-lg p-0.5", className)}
    >
      {OPTIONS.map((o) => {
        const active = theme === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.title}
            onClick={() => setTheme(o.value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
              size === "md" ? "h-10 text-[13px]" : "h-8 text-xs",
              active
                ? "sk-seg-on text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <o.icon className={size === "md" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ThemeMenu({
  className,
  label = false,
  side = "bottom",
  align = "end",
}: {
  className?: string;
  /** Show "Theme" under the icon (navigation rail). */
  label?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
}) {
  const { theme, resolvedTheme } = useTheme();
  const now = resolvedTheme === "dark" ? "dark" : "light";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={className}
          aria-label={`Appearance: ${theme === "system" ? `following this device, ${now}` : now}. Change`}
          title="Appearance"
        >
          {resolvedTheme === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />}
          {label ? <span className="truncate">Theme</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={8} className="w-[17rem] p-3">
        <p className="text-sm font-semibold">Appearance</p>
        <ThemeSwitch size="md" className="mt-2.5" />
        <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {theme === "system"
            ? `Following this device — ${now} right now.`
            : `Staying ${now} on this device. Choose Auto to follow the device again.`}
        </p>
      </PopoverContent>
    </Popover>
  );
}
