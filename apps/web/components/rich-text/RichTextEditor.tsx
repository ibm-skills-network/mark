"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
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
}

/**
 * The editable rich-text surface.
 *
 * Content goes through `prepareStoredHtml` once, at mount; that function owns
 * the sanitize-then-normalize order and why it matters.
 *
 * Mount this through a client-only dynamic import. It touches `DOMParser` on
 * the way in, and the editor itself has no server rendering to do.
 */
const RichTextEditor: React.FC<RichTextEditorProps> = ({
  value,
  setValue,
  className,
  textareaClassName,
  maxWords,
  maxCharacters,
  placeholder = "Write your question here...",
  toolbarMode = "full",
}) => {
  // Mirrored so the editor is created once. Putting these in the `useEditor`
  // dependency array rebuilds the editor mid-typing and loses the selection.
  const setValueRef = useRef(setValue);
  const [counts, setCounts] = useState<RichTextCounts>({
    characters: 0,
    words: 0,
  });

  useEffect(() => {
    setValueRef.current = setValue;
  }, [setValue]);

  const handleCount = useCallback((next: RichTextCounts) => {
    setCounts(next);
  }, []);

  // Computed once. Recomputing on every `value` change would fight the sync
  // effect below and re-seed the document from a string the editor itself just
  // produced.
  const [initialContent] = useState(() => prepareStoredHtml(value));

  const editor = useEditor({
    extensions: createRichTextExtensions({
      mode: toolbarMode,
      placeholder,
      maxWords,
      maxCharacters,
      onCount: handleCount,
    }),
    content: initialContent,
    // Required under the App Router: rendering the editor during the server
    // pass throws on hydration.
    immediatelyRender: false,
    // Report content the schema cannot represent, but keep it. With
    // `enableContentCheck` left off, this is the combination that preserves the
    // stored document instead of dropping to an empty one — the point is to
    // find out about a drop, not to trade it for data loss.
    emitContentError: true,
    onContentError: ({ error }) => {
      console.error("rich-text editor could not parse stored content", error);
    },
    onUpdate: ({ editor: updated }) => {
      setValueRef.current(updated.getHTML());
    },
    editorProps: {
      attributes: {
        // `rich-text-content` is shared with the viewer, so what an author
        // types looks like what a learner is shown.
        class: "rich-text-content rich-text-editor-surface",
        // Changing this breaks `tests/author/assignment-overview.spec.ts` and
        // `components/__tests__/RichTextEditor.test.tsx`, which both locate the
        // editable area by it. Not a shared constant: the Playwright suite is
        // deliberately decoupled from app source and cannot import one.
        "data-testid": "rich-text-editor",
      },
    },
  });

  /**
   * Seeds the counters from the parsed document.
   *
   * Counting the HTML string instead measures tags as words and characters,
   * which is what made the old counter wrong until the first keystroke. It runs
   * here rather than in the editor's own `onCreate`: the editor is constructed
   * during React's subscription phase, so a state update from that callback is
   * discarded without warning and the counters sit at zero.
   */
  useEffect(() => {
    if (!editor) {
      return;
    }
    setCounts(countRichText(editor.state.doc));
  }, [editor]);

  /**
   * Accepts content assigned from outside — a value loaded after mount, or a
   * field reset.
   *
   * `emitUpdate: false` is not an optimisation. The editor re-serialises what
   * it parsed, so `getHTML()` differs from virtually every stored legacy value;
   * emitting here would make merely opening a page save every field, and
   * because the translation cache compares HTML byte-for-byte that bills a
   * re-translation in every supported language for content nobody edited.
   *
   * Compared with `.trim()` because one call site trims inside its own
   * `setValue`, so the parent value never equals what was emitted.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return;
    }

    const incoming = value ?? "";
    if (incoming.trim() === editor.getHTML().trim() || editor.isFocused) {
      return;
    }

    editor.commands.setContent(prepareStoredHtml(incoming), {
      emitUpdate: false,
    });
    setCounts(countRichText(editor.state.doc));
  }, [editor, value]);

  /**
   * Clicking the padding around the editable area focuses it, so the whole
   * bordered box behaves like one field.
   */
  const focusEditorFromShell = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (
      target.closest(".rich-text-toolbar") ||
      target.closest(".rich-text-editor-surface")
    ) {
      return;
    }

    event.preventDefault();
    editor?.commands.focus("end");
  };

  return (
    <div className={cn("rich-text-editor-shell flex flex-col", className)}>
      {editor ? <Toolbar editor={editor} mode={toolbarMode} /> : null}

      <div
        className={cn(
          "rich-text-editor overflow-auto p-2 border border-gray-200 dark:border-gray-600 rounded min-h-[100px] focus-within:border-violet-600 focus-within:ring-2 focus-within:ring-violet-100 dark:focus-within:ring-violet-900/40",
          textareaClassName,
        )}
        onMouseDown={focusEditorFromShell}
      >
        <EditorContent editor={editor} />
      </div>

      {maxWords ? (
        <div
          className={`mt-2 text-sm font-medium leading-tight ${
            counts.words > maxWords ? "text-red-500" : "text-gray-400"
          }`}
        >
          Words: {counts.words} / {maxWords}
        </div>
      ) : null}
      {maxCharacters ? (
        <div
          className={`mt-2 text-sm font-medium leading-tight ${
            counts.characters > maxCharacters ? "text-red-500" : "text-gray-400"
          }`}
        >
          Characters: {counts.characters} / {maxCharacters}
        </div>
      ) : null}
    </div>
  );
};

export default RichTextEditor;
