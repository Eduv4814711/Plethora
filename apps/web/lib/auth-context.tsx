"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AuthUser } from "./api";
import type { LoginResponse } from "./api";
import {
  getMe,
  login as apiLogin,
  logoutSession,
  refreshSession,
  registerTokenRefreshCallback,
} from "./api";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthState & {
  login: (email: string, password: string) => Promise<void>;
  loginWithResponse: (data: LoginResponse) => void;
  logout: () => void;
  setError: (err: string | null) => void;
} | null>(null);

/** Legacy keys — migrated once, then removed. */
const LEGACY_ACCESS_KEY = "plethora_access_token";
const LEGACY_REFRESH_KEY = "plethora_refresh_token";

/** Refresh access token 2 min before expiry. Access token is 15m, so refresh every 12 min. */
const PROACTIVE_REFRESH_MS = 12 * 60 * 1000;

function clearLegacyAuthStorage(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LEGACY_ACCESS_KEY);
  localStorage.removeItem(LEGACY_REFRESH_KEY);
}

function consumeLegacyRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  const legacy = localStorage.getItem(LEGACY_REFRESH_KEY);
  clearLegacyAuthStorage();
  return legacy;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshInFlightRef = useRef(0);

  const applySession = (data: LoginResponse) => {
    setUser(data.user);
    setToken(data.accessToken);
  };

  const doRefresh = async (
    legacyRefreshToken?: string,
    source = "unknown"
  ): Promise<string | null> => {
    refreshInFlightRef.current += 1;
    const inFlight = refreshInFlightRef.current;
    // #region agent log
    fetch("http://127.0.0.1:7661/ingest/453706ed-2456-4856-80b5-ae7dd19b5077", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "2915a3" },
      body: JSON.stringify({
        sessionId: "2915a3",
        runId: "pre-fix",
        hypothesisId: "B",
        location: "auth-context.tsx:doRefresh:start",
        message: "Token refresh started",
        data: { source, inFlight, hasLegacyToken: !!legacyRefreshToken },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    try {
      const data = await refreshSession(legacyRefreshToken);
      applySession(data);
      // #region agent log
      fetch("http://127.0.0.1:7661/ingest/453706ed-2456-4856-80b5-ae7dd19b5077", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "2915a3" },
        body: JSON.stringify({
          sessionId: "2915a3",
          runId: "pre-fix",
          hypothesisId: "B",
          location: "auth-context.tsx:doRefresh:success",
          message: "Token refresh succeeded",
          data: { source, inFlight },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return data.accessToken;
    } catch (err) {
      // #region agent log
      fetch("http://127.0.0.1:7661/ingest/453706ed-2456-4856-80b5-ae7dd19b5077", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "2915a3" },
        body: JSON.stringify({
          sessionId: "2915a3",
          runId: "pre-fix",
          hypothesisId: "A,B,C",
          location: "auth-context.tsx:doRefresh:fail",
          message: "Token refresh failed — clearing session",
          data: {
            source,
            inFlight,
            error: err instanceof Error ? err.message : String(err),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      setUser(null);
      setToken(null);
      return null;
    } finally {
      refreshInFlightRef.current -= 1;
    }
  };

  const doRefreshRef = useRef(doRefresh);
  doRefreshRef.current = doRefresh;

  const scheduleProactiveRefresh = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      // #region agent log
      fetch("http://127.0.0.1:7661/ingest/453706ed-2456-4856-80b5-ae7dd19b5077", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "2915a3" },
        body: JSON.stringify({
          sessionId: "2915a3",
          runId: "pre-fix",
          hypothesisId: "A,C",
          location: "auth-context.tsx:scheduleProactiveRefresh",
          message: "Proactive refresh timer fired",
          data: { intervalMs: PROACTIVE_REFRESH_MS },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      doRefreshRef.current(undefined, "proactive-timer").then((newToken) => {
        if (newToken) scheduleProactiveRefresh();
      });
    }, PROACTIVE_REFRESH_MS);
  };

  useEffect(() => {
    registerTokenRefreshCallback(() => doRefreshRef.current(undefined, "authFetch-401"));
    return () => {
      registerTokenRefreshCallback(() => Promise.resolve(null));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const legacyRefresh = consumeLegacyRefreshToken();

    doRefresh(legacyRefresh ?? undefined, "bootstrap")
      .then((access) => {
        if (access) scheduleProactiveRefresh();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    const data = await apiLogin(email, password);
    applySession(data);
    scheduleProactiveRefresh();
  };

  const loginWithResponse = (data: LoginResponse) => {
    setError(null);
    applySession(data);
    scheduleProactiveRefresh();
  };

  const logout = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    const access = token;
    setUser(null);
    setToken(null);
    clearLegacyAuthStorage();
    if (access) {
      void logoutSession(access).catch(() => undefined);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        login,
        loginWithResponse,
        logout,
        setError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
