/**
 * Global store scope — one filter that follows the signed-in manager
 * across pages instead of resetting on every navigation. The choice is
 * kept for the session (per tab) and always validated against the
 * stores this login is actually allowed to see.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/lib/trpc";

const STORAGE_KEY = "hotspot.store-scope";

type StoreScopeValue = {
  /** "all" or a store name — the one filter every page shares. */
  scope: string;
  setScope: (next: string) => void;
  stores: string[];
  isAdmin: boolean;
};

const StoreScopeContext = createContext<StoreScopeValue | null>(null);

export function StoreScopeProvider({ children }: { children: ReactNode }) {
  const scopeQ = trpc.meta.myScope.useQuery();
  const stores: string[] = scopeQ.data?.stores ?? [];
  const isAdmin = !!scopeQ.data?.isAdmin;
  const [scope, setScopeState] = useState<string>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) ?? "all";
    } catch {
      return "all";
    }
  });

  // A remembered store this login can't see (PIN switch, store revoked)
  // falls back to "all" rather than silently filtering to nothing.
  useEffect(() => {
    if (scopeQ.data && scope !== "all" && !stores.includes(scope)) {
      setScopeState("all");
    }
  }, [scopeQ.data, scope, stores]);

  const setScope = (next: string) => {
    setScopeState(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the scope just won't persist across reloads */
    }
  };

  return (
    <StoreScopeContext.Provider value={{ scope, setScope, stores, isAdmin }}>
      {children}
    </StoreScopeContext.Provider>
  );
}

export function useStoreScope() {
  const ctx = useContext(StoreScopeContext);
  if (!ctx) {
    throw new Error("useStoreScope must be used inside StoreScopeProvider");
  }
  return ctx;
}
