export type Theme = "light" | "dark" | "system";

// Namespaced so a generic "theme" key written by another app on the same
// origin (common on localhost during development) is never honored.
export const THEME_STORAGE_KEY = "mark-theme";
export const THEME_CHANGED_EVENT = "theme-changed";
export const DEFAULT_THEME: Theme = "light";

const VALID_THEMES = new Set<Theme>(["light", "dark", "system"]);

export function isTheme(value: string | null | undefined): value is Theme {
  return Boolean(value && VALID_THEMES.has(value as Theme));
}

/** The persisted preference, or DEFAULT_THEME ("light") when unset/invalid. */
export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Touching localStorage throws SecurityError in storage-blocked
    // third-party iframes (LTI/ALM embeds); fall back to the default
    // rather than crashing the tree.
  }
  return isTheme(stored) ? stored : DEFAULT_THEME;
}

/** Whether the OS currently prefers a dark color scheme. */
export function prefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve a preference to a concrete dark/light decision. */
export function resolveDark(theme: Theme): boolean {
  return theme === "dark" || (theme === "system" && prefersDark());
}

/**
 * Apply a theme to the document without persisting it. Flips the `dark` class
 * on <html> and mirrors it onto the `data-color-mode` attribute.
 * set on <html> so the pre-paint head script and this function stay consistent.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const dark = resolveDark(theme);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.setAttribute(
    "data-color-mode",
    dark ? "dark" : "light",
  );
}

/** Persist a theme preference, apply it, and notify other listeners. */
export function setStoredTheme(theme: Theme): void {
  if (typeof window === "undefined" || !isTheme(theme)) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (third-party iframe) or full; the preference
    // won't persist, but the theme still applies for this page view.
  }
  applyTheme(theme);
  window.dispatchEvent(
    new CustomEvent<Theme>(THEME_CHANGED_EVENT, { detail: theme }),
  );
}
