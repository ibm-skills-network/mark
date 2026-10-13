"use client";

import type { LucideIcon } from "lucide-react";
import { useState, type FC } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COLOR_SWATCHES } from "@/lib/rich-text/toolbar-config";
import { cn } from "@/lib/strings";

import { ACTIVE_CLASS, TOOLBAR_BUTTON_CLASS } from "./ToolbarButton";

const PanelTrigger: FC<{
  label: string;
  icon: LucideIcon;
  isActive: boolean;
}> = ({ label, icon: Icon, isActive }) => (
  <PopoverTrigger
    type="button"
    aria-label={label}
    title={label}
    className={cn(TOOLBAR_BUTTON_CLASS, isActive && ACTIVE_CLASS)}
  >
    <Icon className="h-4 w-4" aria-hidden />
  </PopoverTrigger>
);

export const ColorPopover: FC<{
  label: string;
  icon: LucideIcon;
  isActive: boolean;
  clearLabel: string;
  onPick: (color: string) => void;
  onClear: () => void;
}> = ({ label, icon, isActive, clearLabel, onPick, onClear }) => {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PanelTrigger label={label} icon={icon} isActive={isActive} />
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={label}>
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              title={color}
              onClick={() => {
                onPick(color);
                setOpen(false);
              }}
              className="h-5 w-5 rounded border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            onClear();
            setOpen(false);
          }}
          className="mt-2 w-full rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {clearLabel}
        </button>
      </PopoverContent>
    </Popover>
  );
};

export const UrlPopover: FC<{
  label: string;
  icon: LucideIcon;
  placeholder: string;
  submitLabel: string;
  isActive: boolean;
  initialValue: string;
  onSubmit: (url: string) => void;
  onRemove?: () => void;
  removeLabel?: string;
  onFile?: (file: File) => void;
}> = ({
  label,
  icon,
  placeholder,
  submitLabel,
  isActive,
  initialValue,
  onSubmit,
  onRemove,
  removeLabel,
  onFile,
}) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initialValue);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setUrl(initialValue);
    }
  };

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }
    onSubmit(trimmed);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PanelTrigger label={label} icon={icon} isActive={isActive} />
      <PopoverContent className="w-72 p-2" align="start">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200">
          {label}
          <input
            type="url"
            value={url}
            placeholder={placeholder}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
        </label>
        {onFile ? (
          <label className="mt-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
            Upload image
            <input
              type="file"
              accept="image/*"
              className="mt-1 block w-full text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && file.type.startsWith("image/")) {
                  onFile(file);
                  setOpen(false);
                }
              }}
            />
          </label>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            className="rounded bg-violet-600 px-2 py-1 text-sm text-white hover:bg-violet-700"
          >
            {submitLabel}
          </button>
          {onRemove ? (
            <button
              type="button"
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {removeLabel ?? "Remove"}
            </button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
};
