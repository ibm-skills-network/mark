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
}

const MarkdownEditor: React.FC<Props> = ({
  value,
  setValue,
  className,
  textareaClassName,
  maxWords,
  placeholder = "Write your question here...",
}) => {
  const quillRef = useRef<HTMLDivElement>(null);
  const [quillInstance, setQuillInstance] = useState<any>(null);
  const [wordCount, setWordCount] = useState<number>(
    value?.split(/\s+/).filter(Boolean).length ?? 0,
  );

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
              // [{ header: [1, 2, 3, 4, 5, 6, false] }], in case we need font sizes in the future uncomment this line
              ["bold", "italic", "underline", "strike"],
              ["blockquote", "code-block"],
              [{ list: "ordered" }, { list: "bullet" }],
              [{ script: "sub" }, { script: "super" }],
              [{ indent: "-1" }, { indent: "+1" }],
              [{ direction: "rtl" }],
              [{ color: [] }, { background: [] }],
              [{ font: [] }],
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
          const wordCount = getWordCount(text);
          setWordCount(wordCount);
          if (maxWords && wordCount <= maxWords) {
            setValue(quill.root.innerHTML);
          } else if (!maxWords) {
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
          "quill-editor max-h-96 p-2 border border-gray-300 rounded-lg",
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
    </div>
  );
};

export default MarkdownEditor;
