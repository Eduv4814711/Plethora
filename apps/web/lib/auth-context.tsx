"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { AuthUser } from "./api";
import { getMe, login as apiLogin, refreshToken } from "./api";

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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    const refresh = typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;

    if (stored) {
      getMe(stored)
        .then((me) => {
          setUser(me);
          setToken(stored);
        })
        .catch(() => {
          if (refresh) {
            refreshToken(refresh)
              .then((data) => {
                localStorage.setItem(TOKEN_KEY, data.accessToken);
                localStorage.setItem(REFRESH_KEY, data.refreshToken);
                setUser(data.user);
                setToken(data.accessToken);
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
  };

  const logout = () => {
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
