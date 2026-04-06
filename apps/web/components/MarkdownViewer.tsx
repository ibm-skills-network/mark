"use client";

import { FC, useEffect, useRef, type ComponentPropsWithoutRef } from "react";
import "quill/dist/quill.snow.css";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { cn } from "@/lib/strings";

declare global {
  interface Window {
    hljs: typeof hljs;
  }
}

interface Props extends ComponentPropsWithoutRef<"div"> {
  allowCopy?: boolean;
}

/**
 * MarkdownViewer
 *
 * This component displays Quill-formatted content in read-only mode.
 * It uses the Quill editor without a toolbar and applies syntax highlighting via Highlight.js.
 */
const MarkdownViewer: FC<Props> = (props) => {
  const { className, children, allowCopy = true, ...restOfProps } = props;
  const quillRef = useRef<HTMLDivElement>(null);
  const quillInstanceRef = useRef<any>(null);
  const latestChildrenRef = useRef(children);

  useEffect(() => {
    latestChildrenRef.current = children;
  }, [children]);

  useEffect(() => {
    const container = quillRef.current;
    if (!container) {
      return;
    }

    let isDisposed = false;
    window.hljs = hljs;

    void import("quill").then((QuillModule) => {
      if (
        isDisposed ||
        !container.isConnected ||
        quillRef.current !== container ||
        quillInstanceRef.current
      ) {
        return;
      }

      const Quill = QuillModule.default;
      const quill = new Quill(container, {
        theme: "snow",
        readOnly: true,
        modules: {
          toolbar: false,
          syntax: {
            highlight: (text: string) => hljs.highlightAuto(text).value,
          },
        },
      });

      quill.root.innerHTML = String(latestChildrenRef.current) || "";
      quill.disable();
      quillInstanceRef.current = quill;
    });

    return () => {
      isDisposed = true;

      if (quillInstanceRef.current) {
        quillInstanceRef.current.root.innerHTML = "";
        quillInstanceRef.current = null;
      }

      if (container.isConnected) {
        container.innerHTML = "";
      }
    };
  }, []);

  useEffect(() => {
    if (quillInstanceRef.current) {
      quillInstanceRef.current.root.innerHTML = String(children) || "";
    }
  }, [children]);

  // Style injection (copy control + typography)
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .quill-viewer .ql-container.ql-snow {
        border: none !important;
        min-height: auto !important;
        overflow: visible !important;
        ${allowCopy ? "" : "user-select: none !important;"}
      }
      .quill-viewer .ql-container .ql-editor .ql-code-block-container .ql-ui {
        display: none !important;
      }
      .ql-container.ql-snow .ql-editor {
        font-family: "IBM Plex Sans", sans-serif !important;
        font-size: 16px !important;
        line-height: 1.3 !important;
        background-color: transparent !important;
        min-height: auto !important;
        overflow: visible !important;
        padding: 0 !important;
      }
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
      .ql-editor .hljs {
        padding: 0.2em !important;
        font-size: 0.95em !important;
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.head.removeChild(style);
    };
  }, [allowCopy]);

  return (
    <div className={cn(className, "quill-viewer")} {...restOfProps}>
      <div ref={quillRef} />
    </div>
  );
};

export default MarkdownViewer;
