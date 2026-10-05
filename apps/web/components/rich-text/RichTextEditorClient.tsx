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
 * The editor, loaded on the client and only when a page actually renders one.
 *
 * This is the boundary, not a convenience: `RichTextEditor` prepares its
 * content at mount, which parses HTML through `DOMParser`, so a server render
 * throws. `ssr: false` is what keeps it off the server, and it also keeps the
 * editor and its highlighting grammars in a chunk no first paint has to
 * download — the same effect the previous implementation got from
 * `await import("quill")` inside an effect.
 *
 * Two props are accepted and deliberately unused, exactly as before the editor
 * swap: `allowCopy`, because product judged copy-blocking inside a field an
 * author can type into pointless, and `onBlur`, because the author screen
 * already commits the title from a click-outside listener.
 */
const RichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  // Matches the editable area's collapsed height, so the surrounding form does
  // not jump when the chunk arrives.
  loading: () => (
    <div className="flex flex-col">
      <div className="min-h-[100px] rounded border border-gray-200 p-2 dark:border-gray-600" />
    </div>
  ),
});

const RichTextEditorClient: React.FC<Props> = (props) => (
  <RichTextEditor {...props} />
);

export default RichTextEditorClient;
