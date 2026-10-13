"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
  type DragEvent,
} from "react";

import {
  createRichTextExtensions,
  type ToolbarMode,
} from "@/lib/rich-text/extensions";
import {
  countRichText,
  type RichTextCounts,
} from "@/lib/rich-text/extensions/rich-text-limits";
import { prepareStoredHtml } from "@/lib/rich-text/prepare-stored-html";
import { cn } from "@/lib/strings";
import { sanitizeHtml } from "@/lib/sanitize-html";
import {
  imageFiles,
  insertImageFiles,
} from "@/lib/rich-text/insert-image-files";
import { toast } from "sonner";

import Toolbar from "./toolbar/Toolbar";

export interface RichTextEditorProps
  extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
  allowCopy?: boolean;
  toolbarMode?: ToolbarMode;
  disableListAutofill?: boolean;
  blockImages?: boolean;
  onImageBlocked?: () => void;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  setValue,
  className,
  textareaClassName,
  maxWords,
  maxCharacters,
  placeholder = "Write your question here...",
  toolbarMode = "full",
  disableListAutofill = false,
  blockImages = false,
  onImageBlocked,
}) => {
  const policy = {
    setValue,
    maxWords,
    maxCharacters,
    disableListAutofill,
    blockImages,
    onImageBlocked,
  };
  const policyRef = useRef(policy);
  policyRef.current = policy;

  const lastEmittedRef = useRef<string | null>(null);
  const lastLoadedRef = useRef(value);
  const [counts, setCounts] = useState<RichTextCounts>({
    characters: 0,
    words: 0,
  });

  const [initialContent] = useState(() =>
    prepareStoredHtml(value, { blockImages }),
  );

  const editor = useEditor({
    extensions: createRichTextExtensions({
      mode: toolbarMode,
      placeholder,
      maxWords,
      maxCharacters,
      onCount: setCounts,
      getLimits: () => policyRef.current,
      getImagePolicy: () => policyRef.current,
    }),
    content: initialContent,
    parseOptions: { preserveWhitespace: "full" },
    immediatelyRender: false,
    emitContentError: true,
    onContentError: ({ error }) => {
      console.error("rich-text editor could not parse stored content", error);
    },
    onUpdate: ({ editor: updated }) => {
      const html = sanitizeHtml(updated.getHTML());
      lastEmittedRef.current = html;
      policyRef.current.setValue(html);
    },
    editorProps: {
      attributes: {
        class: "rich-text-content rich-text-editor-surface",
        "data-testid": "rich-text-editor",
        translate: "no",
      },
      transformPastedHTML: (html) => prepareStoredHtml(html, policyRef.current),
      handleTextInput: (view, from, to, text) => {
        if (!policyRef.current.disableListAutofill) return false;
        const $from = view.state.doc.resolve(from);
        const before = $from.parent.textBetween(0, $from.parentOffset);
        if (!/^\s*(?:[-+*]|\d+\.) $/.test(before + text)) return false;
        view.dispatch(view.state.tr.insertText(text, from, to));
        return true;
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData;
        const html = data?.getData("text/html") ?? "";
        const files = imageFiles(data);
        if (policyRef.current.blockImages) {
          if (!files.length && !/<img\b/i.test(html)) return false;
          policyRef.current.onImageBlocked?.();
          // transformPastedHTML removes images while keeping text.
          if (html) return false;
          const text = data?.getData("text/plain") ?? "";
          if (text) view.dispatch(view.state.tr.insertText(text));
          return true;
        }
        if (!files.length || html) return false;
        void insertImageFiles(
          (view.dom as TiptapEditorHTMLElement).editor,
          files,
          { text: data?.getData("text/plain") ?? "" },
        ).catch(() => toast.error("Unable to read image"));
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved || policyRef.current.blockImages) return false;
        const files = imageFiles(event.dataTransfer);
        if (!files.length) return false;
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        void insertImageFiles(
          (view.dom as TiptapEditorHTMLElement).editor,
          files,
          { position },
        ).catch(() => toast.error("Unable to read image"));
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    setCounts(countRichText(editor.state.doc));
  }, [editor]);

  // External loads must not save content or invalidate translations.
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const incoming = value ?? "";
    if (incoming === lastLoadedRef.current) {
      return;
    }
    lastLoadedRef.current = incoming;
    if (incoming.trim() === lastEmittedRef.current?.trim()) return;

    editor.commands.setContent(prepareStoredHtml(incoming, policyRef.current), {
      emitUpdate: false,
      parseOptions: { preserveWhitespace: "full" },
    });
    // Reset undo history when the parent supplies another document.
    editor.view.updateState(
      EditorState.create({
        doc: editor.state.doc,
        selection: editor.state.selection,
        plugins: editor.state.plugins,
      }),
    );
    lastEmittedRef.current = null;
    setCounts(countRichText(editor.state.doc));
  }, [editor, value]);

  const focusEditorFromShell = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".rich-text-toolbar, .rich-text-editor-surface")) {
      return;
    }

    event.preventDefault();
    editor?.commands.focus("end");
  };

  // Capture image drops even where ProseMirror cannot place a caret.
  const blockImageDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!policyRef.current.blockImages) return;
    if (
      !imageFiles(event.dataTransfer).length &&
      !/<img\b/i.test(event.dataTransfer.getData("text/html"))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    policyRef.current.onImageBlocked?.();
  };

  return (
    <div
      className={cn("rich-text-editor-shell flex flex-col", className)}
      onDropCapture={blockImageDrop}
    >
      {editor ? (
        <Toolbar editor={editor} mode={toolbarMode} blockImages={blockImages} />
      ) : null}

      <div
        className={cn(
          "rich-text-editor overflow-auto p-2 border border-gray-200 dark:border-gray-600 rounded min-h-[100px] focus-within:border-violet-600 focus-within:ring-2 focus-within:ring-violet-100 dark:focus-within:ring-violet-900/40",
          textareaClassName,
          "notranslate",
        )}
        translate="no"
        onMouseDown={focusEditorFromShell}
      >
        <EditorContent editor={editor} />
      </div>

      {(
        [
          ["Words", counts.words, maxWords],
          ["Characters", counts.characters, maxCharacters],
        ] as const
      ).map(([label, count, limit]) =>
        limit ? (
          <div
            key={label}
            className={cn(
              "mt-2 text-sm font-medium leading-tight",
              count > limit ? "text-red-500" : "text-gray-400",
            )}
          >
            {label}: {count} / {limit}
          </div>
        ) : null,
      )}
    </div>
  );
};

export default RichTextEditor;
