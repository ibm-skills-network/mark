"use client";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef } from "react";

import type { ToolbarMode } from "@/lib/rich-text/extensions";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
  allowCopy?: boolean;
  toolbarMode?: ToolbarMode;
}

/**
 * Loads the editor on the client, and only when a page actually renders one.
 *
 * The editor and its highlighting grammars are a large chunk that no server
 * render can use — it reaches for `DOMParser` on the way in. The previous
 * implementation got the same effect from `await import("quill")` inside an
 * effect; this keeps the chunk lazy without hand-rolling the loading state.
 *
 * The name and prop shape are unchanged so the call sites did not have to
 * move. Two props are accepted and deliberately unused, exactly as before:
 * `allowCopy`, because product judged copy-blocking inside a field an author
 * can type into pointless, and `onBlur`, because the author screen already
 * commits the title from a click-outside listener. Wiring either one here
 * would be a behaviour change, and none ships with this work.
 */
const RichTextEditor = dynamic(() => import("./rich-text/RichTextEditor"), {
  ssr: false,
  // Matches the editable area's collapsed height, so the surrounding form does
  // not jump when the chunk arrives.
  loading: () => (
    <div className="flex flex-col">
      <div className="min-h-[100px] rounded border border-gray-200 p-2 dark:border-gray-600" />
    </div>
  ),
});

const MarkdownEditor: React.FC<Props> = (props) => (
  <RichTextEditor {...props} />
);

export default MarkdownEditor;
