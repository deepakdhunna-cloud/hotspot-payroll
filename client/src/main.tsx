import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

/**
 * Retry only what a retry can fix. "Not found", "not allowed", "signed out"
 * and bad input will never succeed on a second try — retrying them just
 * holds a skeleton on screen for seconds before the real message shows.
 */
const NO_RETRY_CODES = new Set([
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "BAD_REQUEST",
  "CONFLICT",
]);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const code = (error as { data?: { code?: string } } | null)?.data?.code;
        if (code && NO_RETRY_CODES.has(code)) return false;
        return failureCount < 2;
      },
    },
  },
});

/**
 * A session can end server-side at any moment (the CEO turned the profile
 * off, removed it, or changed its PIN). The first request that comes back
 * "signed out" re-checks the session, so the tab drops to the PIN screen
 * instead of showing errors everywhere.
 */
function recheckSessionIfSignedOut(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") {
    void queryClient.invalidateQueries({ queryKey: [["auth", "me"]] });
  }
}

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Query Error]", event.query.state.error);
    recheckSessionIfSignedOut(event.query.state.error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    console.error("[API Mutation Error]", event.mutation.state.error);
    recheckSessionIfSignedOut(event.mutation.state.error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
