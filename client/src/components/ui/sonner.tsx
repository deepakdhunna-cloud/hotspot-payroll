import { useTheme } from "@/contexts/ThemeContext";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      // Top-center: never on top of the phone tab bar or a sticky "Save
      // changes" bar at the bottom, and clear of the status bar when the app
      // runs from the home screen.
      position="top-center"
      offset={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      mobileOffset={{ top: "calc(0.75rem + env(safe-area-inset-top))", left: 12, right: 12 }}
      richColors={false}
      toastOptions={{
        style: {
          borderRadius: "14px",
          border: "0",
          boxShadow: "var(--shadow-pop)",
          fontFamily: "var(--font-sans)",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
