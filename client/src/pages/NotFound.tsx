import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { useLocation } from "wouter";

/**
 * 404, rendered inside the app's content column so it reads as a page with
 * the nav still in reach, plus the two ways out people actually want.
 */
export default function NotFound() {
  usePageTitle("Page not found");
  const [, setLocation] = useLocation();

  return (
    <div className="flex items-center justify-center py-16 md:py-24">
      <div className="surface-card w-full max-w-md px-6 py-10 text-center sm:px-10">
        <span className="icon-badge icon-badge-lg mx-auto" aria-hidden="true">
          <Compass />
        </span>
        <h1 className="page-title mt-5">Page not found</h1>
        <p className="page-subtitle mx-auto">
          This link doesn&apos;t lead anywhere — it may be mistyped or out of
          date.
        </p>
        <div className="mt-8 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Go back
          </Button>
          <Button onClick={() => setLocation("/")}>
            <Home className="mr-2 h-4 w-4" /> Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
