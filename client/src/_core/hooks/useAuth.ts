import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useMemo } from "react";

/**
 * Backwards-compatible useAuth hook for the PIN-gated app.
 * `user.role` is "admin" (CEO), "cfo" or "manager"; `user.name` is the
 * sign-in profile's name; `user.stores` are a manager's stores (one or
 * several) and `user.store` is set only when there is exactly one.
 */
export function useAuth() {
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    const session = meQuery.data;
    const user = session
      ? {
          role: session.role,
          store: session.store,
          stores: session.stores ?? (session.store ? [session.store] : []),
          scope: session.scope,
          profileId: session.profileId ?? null,
          name:
            session.name ||
            (session.role === "admin"
              ? "CEO"
              : session.role === "cfo"
                ? "CFO"
                : (session.store ?? "Manager")),
        }
      : null;
    return {
      user,
      session,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(session),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
