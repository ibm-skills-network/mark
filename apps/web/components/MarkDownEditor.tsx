/* eslint-disable */
"use client";

import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentPropsWithoutRef,
  type DragEvent,
  type MouseEvent,
} from "react";
import type Quill from "quill";
import "quill/dist/quill.snow.css";
import "highlight.js/styles/vs2015.css";

import { cn } from "@/lib/strings";
import { sanitizeHtml } from "@/lib/sanitize-html";
import hljs from "highlight.js";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
  allowCopy?: boolean;
  toolbarMode?: "full" | "learner";
  /**
   * Turn off Quill's built-in shortcut that converts a line typed as `* `,
   * `- ` or `1. ` into a list item and deletes the marker. Learners type
   * literal markdown and code (e.g. `* item`, `* {`) that must be kept.
   */
  disableListAutofill?: boolean;
  /**
   * Keep images out of the editor: pasted or dropped image files, `<img>` in
   * pasted HTML, and any image embed that arrives another way. Text from the
   * same paste is kept. For learner text answers, which are graded on text
   * only, so an image there is silently worth nothing.
   */
  blockImages?: boolean;
  /** Called whenever `blockImages` stops an image from entering the editor. */
  onImageBlocked?: () => void;
}

// Covers what browsers put on the clipboard for screenshots and copied images,
// so the uploader reports every one of them instead of silently ignoring the
// types outside Quill's png/jpeg default.
const BLOCKED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/tiff",
  "image/avif",
  "image/heic",
];

const IMG_TAG_PATTERN = /<img\b[^>]*>/gi;

interface TransferLike {
  getData(format: string): string;
  files?: ArrayLike<File> | null;
}

function hasImageFile(transfer: TransferLike | null | undefined): boolean {
  return Array.from(transfer?.files ?? []).some((file) =>
    file.type.startsWith("image/"),
  );
}

function hasImageHtml(transfer: TransferLike | null | undefined): boolean {
  return /<img\b/i.test(transfer?.getData("text/html") ?? "");
}

function stripImageTags(html: string): string {
  return html.replace(IMG_TAG_PATTERN, "");
}

const fullToolbarOptions = [
  [{ header: [1, 2, 3, 4, 5, 6, false] }],
  ["bold", "italic", "underline", "strike"],
  ["blockquote", "code-block"],
  [{ list: "ordered" }, { list: "bullet" }],
  [{ script: "sub" }, { script: "super" }],
  [{ indent: "-1" }, { indent: "+1" }],
  [{ direction: "rtl" }],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  ["link", "image", "video"],
  ["clean"],
];

const learnerToolbarOptions = [
  ["bold", "italic", "underline"],
  [{ list: "ordered" }, { list: "bullet" }],
  ["link"],
  ["clean"],
];

const toolbarOptionsByMode = {
  full: fullToolbarOptions,
  learner: learnerToolbarOptions,
};

const MarkdownEditor: React.FC<Props> = ({
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
  const quillRef = useRef<HTMLDivElement>(null);
  const quillObjectRef = useRef<Quill | null>(null);
  const setValueRef = useRef(setValue);
  const onImageBlockedRef = useRef(onImageBlocked);
  const blockImagesRef = useRef(blockImages);
  const maxWordsRef = useRef(maxWords);
  const maxCharactersRef = useRef(maxCharacters);
  const [quillInstance, setQuillInstance] = useState<any>(null);
  const [wordCount, setWordCount] = useState<number>(
    value?.split(/\s+/).filter(Boolean).length ?? 0,
  );
  const [charCount, setCharCount] = useState<number>(value?.length ?? 0);

  useEffect(() => {
    setValueRef.current = setValue;
    maxWordsRef.current = maxWords;
    maxCharactersRef.current = maxCharacters;
    onImageBlockedRef.current = onImageBlocked;
    blockImagesRef.current = blockImages;
  }, [maxCharacters, maxWords, setValue, onImageBlocked, blockImages]);

  const loadHtml = (html: string): string => {
    const clean = sanitizeHtml(html);
    return blockImagesRef.current ? stripImageTags(clean) : clean;
  };

  useEffect(() => {
    let isMounted = true;
    const initializeQuill = async () => {
      if (
        typeof document !== "undefined" &&
        quillRef.current &&
        !quillInstance
      ) {
        window.hljs = hljs;

        const QuillModule = await import("quill");
        if (!isMounted) return;
        const Quill = QuillModule.default;
        const { Delta } = QuillModule;
        const notifyImageBlocked = () => onImageBlockedRef.current?.();
        const toolbar = blockImages
          ? toolbarOptionsByMode[toolbarMode].map((group) =>
              group.filter((item) => item !== "image"),
            )
          : toolbarOptionsByMode[toolbarMode];
        const quill = new Quill(quillRef.current, {
          theme: "snow",
          placeholder,
          modules: {
            toolbar,
            ...(disableListAutofill
              ? { keyboard: { bindings: { "list autofill": null } } }
              : {}),
            ...(blockImages
              ? {
                  // Pasted and dropped image files go through the uploader;
                  // this handler reports them and inserts nothing.
                  uploader: {
                    mimetypes: BLOCKED_IMAGE_MIME_TYPES,
                    handler: notifyImageBlocked,
                  },
                  // `<img>` inside pasted HTML is converted by the clipboard;
                  // an empty delta drops the image and keeps the rest.
                  clipboard: {
                    matchers: [
                      [
                        "IMG",
                        () => {
                          notifyImageBlocked();
                          return new Delta();
                        },
                      ],
                    ],
                  },
                }
              : {}),
            syntax: {
              highlight: (text: string) => hljs.highlightAuto(text).value,
            },
          },
        });

        // Last line of defence for images that arrive some other way (a
        // browser extension, a native drop, an old saved answer). Removing
        // them fires another text-change, which then saves the clean HTML.
        const removeImageEmbeds = (): boolean => {
          let index = 0;
          const removal = new Delta();
          let found = false;
          for (const op of quill.getContents().ops) {
            const length = typeof op.insert === "string" ? op.insert.length : 1;
            if (
              op.insert &&
              typeof op.insert === "object" &&
              "image" in op.insert
            ) {
              removal.retain(index).delete(1);
              found = true;
              index = 0;
              continue;
            }
            index += length;
          }
          if (!found) return false;
          quill.updateContents(removal, "api");
          return true;
        };

        quill.on("text-change", () => {
          if (blockImages && removeImageEmbeds()) {
            notifyImageBlocked();
            return;
          }
          const text = quill.getText().trim();
          const characterLimit = maxCharactersRef.current;
          const wordLimit = maxWordsRef.current;

          if (characterLimit && characterLimit > 0) {
            const charCount = text.length;
            if (charCount <= characterLimit) {
              setCharCount(charCount);
              setValueRef.current(quill.root.innerHTML);
            } else {
              quill.deleteText(charCount - 1, charCount);
            }
          }
          if (wordLimit && wordLimit > 0) {
            const wordsArray = text.split(/\s+/).filter(Boolean);
            const wordCount = wordsArray.length;

            if (wordCount <= wordLimit) {
              setWordCount(wordCount);
              setValueRef.current(quill.root.innerHTML);
            } else {
              quill.deleteText(text.length - 1, text.length);
            }
          } else {
            setValueRef.current(quill.root.innerHTML);
          }
        });

        quill.root.innerHTML = loadHtml(value);
        quillObjectRef.current = quill;
        setQuillInstance(quill);
      }
    };

    initializeQuill();

    return () => {
      isMounted = false;
      if (quillInstance) {
        quillInstance.off("text-change");
        quillInstance.off("selection-change");
        quillObjectRef.current = null;
        setQuillInstance(null);
      }
    };
  }, [
    placeholder,
    quillInstance,
    toolbarMode,
    disableListAutofill,
    blockImages,
  ]);

  // Quill hands a clipboard holding only an image file (a screenshot) to its
  // uploader and discards any plain text that came with it. Capture-phase so
  // this runs before Quill's own listener; the text is inserted here instead.
  const blockImagePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!blockImages) return;
    const data = event.clipboardData;
    if (!hasImageFile(data) || data?.getData("text/html")) return;
    event.preventDefault();
    event.stopPropagation();
    onImageBlockedRef.current?.();
    const quill = quillObjectRef.current;
    const text = data?.getData("text/plain") ?? "";
    if (quill && text) {
      const range = quill.getSelection(true);
      quill.deleteText(range.index, range.length, "user");
      quill.insertText(range.index, text, "user");
      quill.setSelection(range.index + text.length, 0, "silent");
    }
  };

  // Quill's uploader only sees a drop when the browser can place a caret at
  // the drop point, so image drops are stopped here unconditionally.
  const blockImageDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!blockImages) return;
    const data = event.dataTransfer;
    if (!hasImageFile(data) && !hasImageHtml(data)) return;
    event.preventDefault();
    event.stopPropagation();
    onImageBlockedRef.current?.();
  };

  const focusEditorFromShell = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".ql-toolbar") || target.closest(".ql-editor")) {
      return;
    }

    event.preventDefault();
    quillInstance?.focus();
  };

  useEffect(() => {
    if (quillInstance) {
      const currentHTML = quillInstance.root.innerHTML;
      if (currentHTML !== value && !quillInstance.hasFocus()) {
        quillInstance.root.innerHTML = loadHtml(value);
      }
    }
  }, [quillInstance, value]);

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .quill-editor-shell .ql-container.ql-snow {
        min-height: 100px !important;
        height: auto !important;
        overflow: visible !important;
      }
      .quill-editor-shell .ql-container.ql-snow .ql-editor {
        font-family: "IBM Plex Sans", sans-serif !important;
        font-size: 16px !important;
        line-height: 1.3 !important;
        background-color: transparent !important;
        height: auto !important;
        min-height: 98px !important;
        overflow: visible !important;
        padding: 0 !important;
      }
      .quill-editor-shell .ql-editor p,
      .quill-editor-shell .ql-editor li,
      .quill-editor-shell .ql-editor blockquote {
        margin: 0.25em 0 !important; 
      }
      .quill-editor-shell .ql-editor ul,
      .quill-editor-shell .ql-editor ol {
        padding-left: 1em !important; 
        margin: 0.25em 0 !important; 
      }
      .quill-editor-shell .ql-editor code {
        white-space: pre-wrap !important;
        line-height: 1 !important; 
        padding: 0.1em 0.2em !important;
        background-color: #f5f5f5 !important;
      }
      .quill-editor-shell .ql-editor pre {
        background-color: #f5f5f5 !important;
      }
      .quill-editor-shell .ql-editor .hljs {
        padding: 0.2em !important;
        font-size: 0.95em !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div
      className={cn("quill-editor-shell flex flex-col", className)}
      onPasteCapture={blockImagePaste}
      onDropCapture={blockImageDrop}
    >
      <div
        className={cn(
          "quill-editor notranslate overflow-auto p-2 border border-gray-200 dark:border-gray-600 rounded min-h-[100px] focus-within:border-violet-600 focus-within:ring-2 focus-within:ring-violet-100 dark:focus-within:ring-violet-900/40",
          textareaClassName,
        )}
        ref={quillRef}
        translate="no"
        onMouseDown={focusEditorFromShell}
      />

      {maxWords ? (
        <div
          className={`mt-2 text-sm font-medium leading-tight ${
            wordCount > maxWords ? "text-red-500" : "text-gray-400"
          }`}
        >
          Words: {wordCount} / {maxWords}
        </div>
      ) : null}
      {maxCharacters ? (
        <div
          className={`mt-2 text-sm font-medium leading-tight ${
            charCount > maxCharacters ? "text-red-500" : "text-gray-400"
          }`}
        >
          Characters: {charCount} / {maxCharacters}
        </div>
      ) : null}
    </div>
  );
};

export default MarkdownEditor;
