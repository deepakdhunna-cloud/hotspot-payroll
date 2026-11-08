import { AlertTriangle, LayoutDashboard, RotateCw } from "lucide-react";
import { Component, ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Last-resort screen when a page crashes while rendering. People see one
 * plain sentence and two ways forward in the house button style; the raw
 * stack is a developer's tool, so it only exists in development builds,
 * folded away under "Technical details".
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // This boundary sits outside the router (and on the kiosk), so plain
    // links and a full reload are the safe ways out.
    const onKiosk =
      typeof window !== "undefined" && window.location.pathname.startsWith("/clock");
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-4">
        <div
          role="alert"
          className="surface-card w-full max-w-md px-6 py-10 text-center sm:px-10"
        >
          <span className="icon-badge icon-badge-lg mx-auto" aria-hidden="true">
            <AlertTriangle />
          </span>
          <h1 className="page-title mt-5">Something went wrong</h1>
          <p className="page-subtitle mx-auto">
            This screen hit an unexpected problem. Reloading usually fixes it —
            everything you already saved is safe.
          </p>
          <div className="mt-8 flex flex-col-reverse justify-center gap-2 sm:flex-row">
            {!onKiosk ? (
              <a href="/" className={buttonVariants({ variant: "outline" })}>
                <LayoutDashboard className="h-4 w-4" aria-hidden />
                Go to dashboard
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={buttonVariants()}
            >
              <RotateCw className="h-4 w-4" aria-hidden />
              Reload
            </button>
          </div>

          {import.meta.env.DEV && this.state.error ? (
            <details className="mt-8 text-left">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Technical details (development only)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
                {this.state.error.stack ?? String(this.state.error)}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
