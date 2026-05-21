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

  const applySession = (data: LoginResponse) => {
    setUser(data.user);
    setToken(data.accessToken);
  };

  const doRefresh = async (legacyRefreshToken?: string): Promise<string | null> => {
    try {
      const data = await refreshSession(legacyRefreshToken);
      applySession(data);
      return data.accessToken;
    } catch {
      setUser(null);
      setToken(null);
      return null;
    }
  };

  const doRefreshRef = useRef(doRefresh);
  doRefreshRef.current = doRefresh;

  const scheduleProactiveRefresh = () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      doRefreshRef.current().then((newToken) => {
        if (newToken) scheduleProactiveRefresh();
      });
    }, PROACTIVE_REFRESH_MS);
  };

  useEffect(() => {
    registerTokenRefreshCallback(() => doRefreshRef.current());
    return () => {
      registerTokenRefreshCallback(() => Promise.resolve(null));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const legacyRefresh = consumeLegacyRefreshToken();

    doRefresh(legacyRefresh ?? undefined)
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
