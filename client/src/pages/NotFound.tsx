import { Button } from "@/components/ui/button";
import { ArrowLeft, Home } from "lucide-react";
import { useLocation } from "wouter";

/**
 * On-brand 404 — renders inside DashboardLayout's content column, so it
 * frames itself like a page, not a stranded full-screen card.
 */
export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex items-center justify-center py-20">
      <div className="surface-card w-full max-w-lg px-8 py-10 text-center">
        <span className="speed-lines mx-auto opacity-50" aria-hidden="true">
          <i />
        </span>
        <p className="eyebrow mt-5">Wrong aisle</p>
        <h1 className="page-title mt-2">404</h1>
        <p className="page-subtitle mx-auto">
          This page doesn&apos;t exist — it may have been moved, or the link is
          stale (a deleted employee profile is the usual culprit).
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button variant="outline" className="bg-card" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go back
          </Button>
          <Button onClick={() => setLocation("/")}>
            <Home className="mr-2 h-4 w-4" /> Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
