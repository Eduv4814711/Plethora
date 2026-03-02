"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AuthUser } from "./api";
import { getMe, login as apiLogin, refreshToken, registerTokenRefreshCallback } from "./api";

type AuthState = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
};

const AuthContext = createContext<AuthState & {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  setError: (err: string | null) => void;
} | null>(null);

const TOKEN_KEY = "plethora_access_token";
const REFRESH_KEY = "plethora_refresh_token";

/** Refresh access token 2 min before expiry. Access token is 15m, so refresh every 12 min. */
const PROACTIVE_REFRESH_MS = 12 * 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doRefresh = async (): Promise<string | null> => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;
    if (!stored) return null;
    try {
      const data = await refreshToken(stored);
      if (typeof window !== "undefined") {
        localStorage.setItem(TOKEN_KEY, data.accessToken);
        localStorage.setItem(REFRESH_KEY, data.refreshToken);
      }
      setUser(data.user);
      setToken(data.accessToken);
      return data.accessToken;
    } catch {
      if (typeof window !== "undefined") {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
      }
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
    registerTokenRefreshCallback(doRefresh);
    return () => {
      registerTokenRefreshCallback(() => Promise.resolve(null));
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const refresh = typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;

    if (stored) {
      getMe(stored)
        .then((me) => {
          setUser(me);
          setToken(stored);
          scheduleProactiveRefresh();
        })
        .catch(() => {
          if (refresh) {
            refreshToken(refresh)
              .then((data) => {
                localStorage.setItem(TOKEN_KEY, data.accessToken);
                localStorage.setItem(REFRESH_KEY, data.refreshToken);
                setUser(data.user);
                setToken(data.accessToken);
                scheduleProactiveRefresh();
              })
              .catch(() => {
                localStorage.removeItem(TOKEN_KEY);
                localStorage.removeItem(REFRESH_KEY);
              });
          }
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email: string, password: string) => {
    setError(null);
    const data = await apiLogin(email, password);
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_KEY, data.refreshToken);
    setUser(data.user);
    setToken(data.accessToken);
    scheduleProactiveRefresh();
  };

  const logout = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        login,
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
