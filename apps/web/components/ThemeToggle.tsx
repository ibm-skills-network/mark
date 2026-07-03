"use client";

import { MoonIcon, SunIcon } from "@heroicons/react/24/outline";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/strings";

interface ThemeToggleProps {
  className?: string;
}

/**
 * Quick light/dark switch for the app headers. Flips the resolved theme and
 * persists it via the shared theme module (kept in sync with the chatbot's
 * theme selector).
 */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { isDark, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 transition-colors",
        className,
      )}
    >
      {isDark ? (
        <SunIcon className="w-5 h-5" />
      ) : (
        <MoonIcon className="w-5 h-5" />
      )}
    </button>
  );
}
