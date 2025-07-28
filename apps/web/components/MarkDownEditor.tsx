/* eslint-disable */
"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import "quill/dist/quill.snow.css";
import "highlight.js/styles/vs2015.css";

import { cn } from "@/lib/strings";
import { getWordCount } from "@/lib/utils";
import hljs from "highlight.js";

interface Props extends ComponentPropsWithoutRef<"section"> {
  value: string;
  setValue: (value: string) => void;
  placeholder?: string;
  textareaClassName?: string;
  maxWords?: number | null;
  maxCharacters?: number | null;
}

const MarkdownEditor: React.FC<Props> = ({
  value,
  setValue,
  className,
  textareaClassName,
  maxWords,
  maxCharacters,
  placeholder = "Write your question here...",
}) => {
  const quillRef = useRef<HTMLDivElement>(null);
  const [quillInstance, setQuillInstance] = useState<any>(null);
  const [wordCount, setWordCount] = useState<number>(
    value?.split(/\s+/).filter(Boolean).length ?? 0,
  );
  const [charCount, setCharCount] = useState<number>(value?.length ?? 0);

  useEffect(() => {
    let isMounted = true;
    const initializeQuill = async () => {
      if (
        typeof document !== "undefined" &&
        quillRef.current &&
        !quillInstance
      ) {
        const existingToolbars = document.querySelectorAll(".ql-toolbar");
        existingToolbars.forEach((toolbar, index) => {
          if (index > 0) toolbar.remove();
        });

        window.hljs = hljs;

        const QuillModule = await import("quill");
        if (!isMounted) return;
        const Quill = QuillModule.default;
        const quill = new Quill(quillRef.current, {
          theme: "snow",
          placeholder,
          modules: {
            toolbar: [
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
            ],
            syntax: {
              highlight: (text: string) => hljs.highlightAuto(text).value,
            },
          },
        });

        quill.on("text-change", () => {
          const text = quill.getText().trim();

          if (maxCharacters && maxCharacters > 0) {
            const charCount = text.length;
            if (charCount <= maxCharacters) {
              setCharCount(charCount);
              setValue(quill.root.innerHTML);
            } else {
              quill.deleteText(charCount - 1, charCount);
            }
          }
          if (maxWords && maxWords > 0) {
            const wordsArray = text.split(/\s+/).filter(Boolean);
            const wordCount = wordsArray.length;

            if (wordCount <= maxWords) {
              setWordCount(wordCount);
              setValue(quill.root.innerHTML);
            } else {
              quill.deleteText(text.length - 1, text.length);
            }
          } else {
            setValue(quill.root.innerHTML);
          }
        });

        quill.root.innerHTML = value;
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
  }, [quillInstance]);

  useEffect(() => {
    if (quillInstance) {
      const currentHTML = quillInstance.root.innerHTML;

      if (currentHTML !== value && !quillInstance.hasFocus()) {
        quillInstance.root.innerHTML = value;
      }
    }
  }, [quillInstance, value]);

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .ql-container.ql-snow {
        min-height: 100px !important;
        height: auto !important;
        overflow: visible !important;
      }
      .ql-container.ql-snow .ql-editor {
        font-family: "IBM Plex Sans", sans-serif !important;
        font-size: 16px !important;
        line-height: 1.3 !important;
        background-color: transparent !important;
        height: auto !important;
        overflow: visible !important;
       padding: 0 !important;
      }
      /* Optional: Adjust spacing for list items, paragraphs, etc. */
      .ql-editor p,
      .ql-editor li,
      .ql-editor blockquote {
        margin: 0.25em 0 !important; 
      }
      .ql-editor ul,
      .ql-editor ol {
        padding-left: 1em !important; 
        margin: 0.25em 0 !important; 
      }
      .ql-editor code {
        white-space: pre-wrap !important;
        line-height: 1 !important; 
        padding: 0.1em 0.2em !important;
        background-color: #f5f5f5 !important;
      }
      .ql-editor pre {
        background-color: #f5f5f5 !important;
      }
      /* Syntax highlighting tweak */
      .ql-editor .hljs {
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
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(
          "quill-editor overflow-auto p-2 border border-gray-200 rounded min-h-[100px]",
          textareaClassName,
        )}
        ref={quillRef}
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
