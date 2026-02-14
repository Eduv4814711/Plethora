"use client";

import { useEffect } from "react";
import { useSettings } from "@/lib/settings-context";

export function ThemeApplier() {
  const { settings } = useSettings();
  const theme = settings?.theme;

  useEffect(() => {
    if (!theme) return;

    const root = document.documentElement;

    const accent = theme.primaryColor ?? theme.accentColor;
    if (accent) {
      root.style.setProperty("--accent", accent);
      root.style.setProperty("--accent-hover", theme.accentColor ?? accent);
    }

    if (theme.mode === "light") {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
    } else if (theme.mode === "dark") {
      root.classList.add("dark");
      root.style.colorScheme = "dark";
    } else if (theme.mode === "system") {
      root.classList.remove("dark");
      root.style.colorScheme = "light";
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => {
        if (mq.matches) {
          root.classList.add("dark");
          root.style.colorScheme = "dark";
        } else {
          root.classList.remove("dark");
          root.style.colorScheme = "light";
        }
      };
      mq.addEventListener("change", apply);
      apply();
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  return null;
}
