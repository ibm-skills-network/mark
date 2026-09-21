"use client";

import type { FC, ReactNode } from "react";

import { cn } from "@/lib/strings";

/**
 * Shared by the plain buttons and by the popover triggers, so a control that
 * opens a panel is not visibly a different kind of thing from one that toggles
 * a mark.
 */
export const TOOLBAR_BUTTON_CLASS =
  "inline-flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-gray-700";

const ToolbarButton: FC<{
  label: string;
  isActive: boolean;
  isDisabled: boolean;
  onClick: () => void;
  children: ReactNode;
}> = ({ label, isActive, isDisabled, onClick, children }) => (
  <button
    // These sit inside the author form, which a plain button would submit.
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={isActive}
    disabled={isDisabled}
    // Pressing a toolbar button must not take focus from the document, or the
    // selection the command is about to act on is gone before it runs.
    onMouseDown={(event) => event.preventDefault()}
    onClick={onClick}
    className={cn(
      TOOLBAR_BUTTON_CLASS,
      isActive &&
        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
    )}
  >
    {children}
  </button>
);

export default ToolbarButton;
