/* eslint-disable */
"use client";
import {
  type ComponentPropsWithoutRef,
  useEffect,
  useRef,
  useState,
} from "react";
import "quill/dist/quill.snow.css"; // Ensure correct CSS import
import "highlight.js/styles/vs2015.css"; // Import a Highlight.js theme

import { getWordCount } from "@/lib/utils";
import hljs from "highlight.js";
import { cn } from "@/lib/strings";

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
  const [charCount, setCharCount] = useState<number>(value.length ?? 0);

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
        // Ensure hljs is available globally
        // @ts-ignore
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
          if (maxCharacters) {
            const charCount = text.length;
            if (charCount > maxCharacters) {
              quill.deleteText(maxCharacters, text.length);
            } else if (charCount <= maxCharacters) {
              setCharCount(charCount);
            }
          } else if (maxWords && text) {
            const wordCount = getWordCount(text);
            if (wordCount > maxWords) {
              quill.deleteText(text.length - 1, text.length);
            } else if (wordCount <= maxWords) {
              setWordCount(wordCount);
            }
          }
          setValue(quill.root.innerHTML);
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

  // keep the value in sync with the editor
  useEffect(() => {
    if (quillInstance) {
      quillInstance.root.innerHTML = value;
    }
  }, [quillInstance]);

  return (
    <div className={cn("flex flex-col", className)}>
      <div
        className={cn(
          "quill-editor overflow-auto p-2 border border-gray-200 rounded",
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
