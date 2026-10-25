import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { AuthSessionResponse } from "@bb/server-contract";
import { apiClient } from "@/lib/api-server";

export function AuthentikGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [session, setSession] = useState<AuthSessionResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void apiClient.auth.session
      .$get()
      .then(async (response) => {
        if (!response.ok) throw new Error("session request failed");
        const value = await response.json();
        if (active) setSession(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (session?.enabled !== true || session.user !== null) return;
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.assign(
      `/auth/authentik/login?returnTo=${encodeURIComponent(returnTo)}`,
    );
  }, [location.hash, location.pathname, location.search, session]);

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-sm text-destructive">
        Couldn't check the server login session. Reload to try again.
      </main>
    );
  }
  if (session === null || (session.enabled && session.user === null)) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-sm text-muted-foreground">
        Signing in…
      </main>
    );
  }
  return children;
}
