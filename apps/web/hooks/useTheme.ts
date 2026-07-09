"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_CHANGED_EVENT,
  THEME_STORAGE_KEY,
  type Theme,
  applyTheme,
  getStoredTheme,
  resolveDark,
  setStoredTheme,
} from "@/lib/theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);
  // The server can't know the stored preference or the OS scheme, so isDark
  // stays false until after mount to keep the hydration render identical to
  // the server HTML (the pre-paint script already colors the page correctly).
  const [mounted, setMounted] = useState(false);
  const [systemDark, setSystemDark] = useState(false);

  // Sync from storage on mount, when another consumer changes it, and when
  // another tab writes the stored preference.
  useEffect(() => {
    setMounted(true);
    setThemeState(getStoredTheme());
    const onThemeChanged = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next) setThemeState(next);
    };
    const onStorage = (event: StorageEvent) => {
      // key === null means the whole store was cleared.
      if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
      const next = getStoredTheme();
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener(THEME_CHANGED_EVENT, onThemeChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, onThemeChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Track the OS scheme so isDark stays in sync while following "system",
  // and re-apply the document class when the OS flips.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const onChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setStoredTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setStoredTheme(resolveDark(getStoredTheme()) ? "light" : "dark");
  }, []);

  const isDark =
    mounted && (theme === "dark" || (theme === "system" && systemDark));

  return { theme, isDark, setTheme, toggle };
}
