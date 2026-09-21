"use client";

import type { Editor } from "@tiptap/core";
import {
  Baseline,
  Highlighter,
  Image as ImageIcon,
  Link2,
  Video,
} from "lucide-react";
import { useState, type FC, type ReactNode } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { COLOR_SWATCHES } from "@/lib/rich-text/toolbar-config";
import { cn } from "@/lib/strings";

import { TOOLBAR_BUTTON_CLASS } from "./ToolbarButton";

/**
 * A toolbar control that opens a panel.
 *
 * The trigger carries the same classes as a plain toolbar button so the row
 * reads as one set of controls, and `type="button"` because these live inside
 * the author form and would otherwise submit it.
 */
const PanelTrigger: FC<{
  label: string;
  isActive?: boolean;
  children: ReactNode;
}> = ({ label, isActive = false, children }) => (
  <PopoverTrigger
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      TOOLBAR_BUTTON_CLASS,
      isActive &&
        "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
    )}
  >
    {children}
  </PopoverTrigger>
);

/**
 * Colour and background-colour pickers.
 *
 * The swatch grid is the previous editor's own palette, so an author opens this
 * and sees the colours they already know. "Remove" is kept distinct from
 * picking white — unsetting the mark and painting white text look identical on
 * a white page and behave differently everywhere else.
 */
export const ColorPopover: FC<{
  editor: Editor;
  kind: "color" | "backgroundColor";
  isActive: boolean;
}> = ({ editor, kind, isActive }) => {
  const [open, setOpen] = useState(false);
  const label = kind === "color" ? "Text colour" : "Background colour";

  const apply = (color: string) => {
    if (kind === "color") {
      editor.chain().focus().setColor(color).run();
    } else {
      editor.chain().focus().setBackgroundColor(color).run();
    }
    setOpen(false);
  };

  const clear = () => {
    if (kind === "color") {
      editor.chain().focus().unsetColor().run();
    } else {
      editor.chain().focus().unsetBackgroundColor().run();
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PanelTrigger label={label} isActive={isActive}>
        {kind === "color" ? (
          <Baseline className="h-4 w-4" aria-hidden />
        ) : (
          <Highlighter className="h-4 w-4" aria-hidden />
        )}
      </PanelTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={label}>
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              title={color}
              onClick={() => apply(color)}
              className="h-5 w-5 rounded border border-gray-300 dark:border-gray-600"
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={clear}
          className="mt-2 w-full rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Remove {kind === "color" ? "colour" : "background"}
        </button>
      </PopoverContent>
    </Popover>
  );
};

/**
 * A panel that takes one URL and applies it.
 *
 * Shared by link, image and video because the interaction is identical and the
 * only real difference is which command runs. The URL is not validated here:
 * the sanitizer decides which protocols and embed hosts survive, and a second
 * opinion in the toolbar is how the two drift apart.
 */
const UrlPopover: FC<{
  label: string;
  placeholder: string;
  submitLabel: string;
  icon: ReactNode;
  isActive?: boolean;
  initialValue?: string;
  onSubmit: (url: string) => void;
  onRemove?: () => void;
  removeLabel?: string;
}> = ({
  label,
  placeholder,
  submitLabel,
  icon,
  isActive = false,
  initialValue = "",
  onSubmit,
  onRemove,
  removeLabel,
}) => {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(initialValue);

  // Re-seeded each time the panel opens, so editing an existing link shows the
  // current target rather than whatever was last typed.
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
      <PanelTrigger label={label} isActive={isActive}>
        {icon}
      </PanelTrigger>
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

export const LinkPopover: FC<{ editor: Editor; isActive: boolean }> = ({
  editor,
  isActive,
}) => (
  <UrlPopover
    label="Link"
    placeholder="https://example.com"
    submitLabel="Apply"
    icon={<Link2 className="h-4 w-4" aria-hidden />}
    isActive={isActive}
    initialValue={(editor.getAttributes("link").href as string) ?? ""}
    onSubmit={(url) =>
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run()
    }
    onRemove={
      isActive
        ? () => editor.chain().focus().extendMarkRange("link").unsetLink().run()
        : undefined
    }
    removeLabel="Remove link"
  />
);

export const ImagePopover: FC<{ editor: Editor }> = ({ editor }) => (
  <UrlPopover
    label="Image"
    placeholder="https://example.com/image.png"
    submitLabel="Insert"
    icon={<ImageIcon className="h-4 w-4" aria-hidden />}
    onSubmit={(url) => editor.chain().focus().setImage({ src: url }).run()}
  />
);

export const VideoPopover: FC<{ editor: Editor }> = ({ editor }) => (
  <UrlPopover
    label="Video"
    placeholder="https://www.youtube.com/embed/..."
    submitLabel="Insert"
    icon={<Video className="h-4 w-4" aria-hidden />}
    onSubmit={(url) => editor.chain().focus().setVideo({ src: url }).run()}
  />
);
