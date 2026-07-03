"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_THEME,
  THEME_CHANGED_EVENT,
  type Theme,
  applyTheme,
  getStoredTheme,
  resolveDark,
  setStoredTheme,
} from "@/lib/theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // Sync from storage on mount and whenever another consumer changes it.
  useEffect(() => {
    setThemeState(getStoredTheme());
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<Theme>).detail;
      if (next) setThemeState(next);
    };
    window.addEventListener(THEME_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGED_EVENT, onChange);
  }, []);

  // While following the OS ("system"), re-apply when it flips.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setStoredTheme(next);
  }, []);

  const toggle = useCallback(() => {
    setStoredTheme(resolveDark(getStoredTheme()) ? "light" : "dark");
  }, []);

  return { theme, isDark: resolveDark(theme), setTheme, toggle };
}
