import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      // Top-center, below the floating nav: never on top of the phone tab
      // bar or a sticky "Save changes" bar at the bottom.
      position="top-center"
      offset={{ top: 80 }}
      mobileOffset={{ top: 72, left: 12, right: 12 }}
      richColors={false}
      toastOptions={{
        style: {
          borderRadius: "14px",
          border: "0",
          boxShadow:
            "0 0 0 1px oklch(0.2 0.01 30 / 0.08), 0 12px 32px -12px oklch(0.2 0.01 30 / 0.35)",
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
