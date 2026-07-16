"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import type { CompanySettings } from "./api";
import { getSettings, updateSettings } from "./api";
import { useAuth } from "./auth-context";

type SettingsState = {
  settings: CompanySettings | null;
  loading: boolean;
  error: string | null;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  update: (data: Parameters<typeof updateSettings>[1]) => Promise<void>;
};

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** After first successful load, refetch in the background (e.g. token rotation) without blanking the whole app. */
  const settingsHydratedRef = useRef(false);

  const fetchSettings = async () => {
    if (!token) {
      settingsHydratedRef.current = false;
      setSettings(null);
      setLoading(false);
      return;
    }
    const blockUI = !settingsHydratedRef.current;
    if (blockUI) setLoading(true);
    setError(null);
    try {
      const data = await getSettings(token);
      setSettings(data);
      settingsHydratedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
      setSettings(null);
    } finally {
      if (blockUI) setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      fetchSettings();
    } else {
      settingsHydratedRef.current = false;
      setSettings(null);
      setLoading(false);
    }
  }, [token]);

  const update = async (
    data: Parameters<typeof updateSettings>[1]
  ) => {
    if (!token) throw new Error("Not authenticated");
    const updated = await updateSettings(token, data);
    setSettings(updated);
  };

  const needsSetup = settings?.name === "My Company";

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        error,
        needsSetup,
        refresh: fetchSettings,
        update,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
