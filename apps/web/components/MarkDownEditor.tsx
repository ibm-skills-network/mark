/* eslint-disable */
"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type MouseEvent,
} from "react";
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
}) => {
  const quillRef = useRef<HTMLDivElement>(null);
  const setValueRef = useRef(setValue);
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
  }, [maxCharacters, maxWords, setValue]);

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
        const quill = new Quill(quillRef.current, {
          theme: "snow",
          placeholder,
          modules: {
            toolbar: toolbarOptionsByMode[toolbarMode],
            syntax: {
              highlight: (text: string) => hljs.highlightAuto(text).value,
            },
          },
        });

        quill.on("text-change", () => {
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

        quill.root.innerHTML = sanitizeHtml(value);
        setQuillInstance(quill);
      }
    };

    initializeQuill();

    return () => {
      isMounted = false;
      if (quillInstance) {
        quillInstance.off("text-change");
        quillInstance.off("selection-change");
        setQuillInstance(null);
      }
    };
  }, [placeholder, quillInstance, toolbarMode]);

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
        quillInstance.root.innerHTML = sanitizeHtml(value);
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
    <div className={cn("quill-editor-shell flex flex-col", className)}>
      <div
        className={cn(
          "quill-editor overflow-auto p-2 border border-gray-200 rounded min-h-[100px] focus-within:border-violet-600 focus-within:ring-2 focus-within:ring-violet-100",
          textareaClassName,
        )}
        ref={quillRef}
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
