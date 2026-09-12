"use client";

import {
  FC,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import "quill/dist/quill.snow.css";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { cn } from "@/lib/strings";
import { sanitizeHtml } from "@/lib/sanitize-html";

declare global {
  interface Window {
    hljs: typeof hljs;
  }
}

interface Props extends ComponentPropsWithoutRef<"div"> {
  allowCopy?: boolean;
}

/**
 * The editor writes list items as `<li data-list="…">` plus an empty marker
 * span that the stylesheet turns into the bullet or number. Content that
 * reaches the viewer without that span (round-tripped through translation, or
 * authored elsewhere) would otherwise render as an unmarked list, because
 * `.ql-editor li` sets `list-style-type: none`.
 *
 * The repair is done on the parsed DOM, never on the sanitized string. An
 * attribute value is allowed to contain `>`, so a string edit cannot tell a
 * real tag boundary from one inside a value: splicing a span after the wrong
 * `>` ends the `<li>` early and re-parsing turns the rest of that value into
 * live elements, which is how sanitized content becomes an injection again.
 */
const addMissingListMarkers = (editor: HTMLElement): void => {
  for (const item of editor.querySelectorAll<HTMLElement>("li[data-list]")) {
    if (item.firstElementChild?.classList.contains("ql-ui")) {
      continue;
    }

    const marker = document.createElement("span");
    marker.className = "ql-ui";
    marker.setAttribute("contenteditable", "false");
    item.prepend(marker);
  }
};

/**
 * MarkdownViewer
 *
 * Read-only renderer for the rich text the authoring editor produces. It
 * renders sanitized, static HTML inside the editor's own class names so the
 * stylesheet applies, and deliberately does NOT instantiate an editor: a live
 * editor keeps a MutationObserver on this subtree and re-derives its internal
 * model from whatever is written to it, which can discard markup it cannot map
 * — losing the text of a list item while its bullet survives. Static markup has
 * no observer, so what is sanitized is what the learner sees.
 *
 * Code blocks keep their syntax highlighting, applied once per content change.
 */
const MarkdownViewer: FC<Props> = (props) => {
  const { className, children, allowCopy = true, ...restOfProps } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  const html = useMemo(() => {
    const raw =
      children === null || children === undefined ? "" : String(children);
    return sanitizeHtml(raw);
  }, [children]);

  // Sanitization needs a DOM, so the first paint stays empty and the content
  // is committed on the client. Rendering the server-side fallback instead
  // would leave a hydration mismatch that React cannot repair for raw HTML.
  useEffect(() => {
    setIsMounted(true);
    window.hljs = hljs;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    addMissingListMarkers(editor);

    for (const block of editor.querySelectorAll<HTMLElement>(
      ".ql-code-block[data-language]",
    )) {
      const language = block.dataset.language;
      const source = block.textContent ?? "";

      if (!language || language === "plain" || !source) {
        continue;
      }

      if (!hljs.getLanguage(language)) {
        continue;
      }

      // highlight.js escapes the source it is given, so its output carries no
      // markup from the content itself.
      block.innerHTML = hljs.highlight(source, {
        language,
        ignoreIllegals: true,
      }).value;
    }
  }, [html, isMounted]);

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
      .quill-viewer .ql-container.ql-snow .ql-editor {
        font-family: "IBM Plex Sans", sans-serif !important;
        font-size: 16px !important;
        line-height: 1.3 !important;
        background-color: transparent !important;
        min-height: auto !important;
        overflow: visible !important;
        padding: 0 !important;
      }
      .quill-viewer .ql-editor p,
      .quill-viewer .ql-editor li,
      .quill-viewer .ql-editor blockquote {
        margin: 0.25em 0 !important;
      }
      .quill-viewer .ql-editor ul,
      .quill-viewer .ql-editor ol {
        padding-left: 1em !important;
        margin: 0.25em 0 !important;
      }
      .quill-viewer .ql-editor code {
        white-space: pre-wrap !important;
        line-height: 1 !important;
        padding: 0.1em 0.2em !important;
        background-color: #f5f5f5 !important;
      }
      .quill-viewer .ql-editor pre {
        background-color: #f5f5f5 !important;
      }
      .quill-viewer .ql-editor .hljs {
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
      <div className="ql-container ql-snow">
        <div
          ref={editorRef}
          className="ql-editor"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: isMounted ? html : "" }}
        />
      </div>
    </div>
  );
};

export default MarkdownViewer;
