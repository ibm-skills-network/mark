"use client";

import hljs from "highlight.js";
import { normalizeQuillHtml } from "rich-text";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

import { sanitizeHtml } from "@/lib/sanitize-html";
import { cn } from "@/lib/strings";

export interface RichTextViewerProps extends ComponentPropsWithoutRef<"div"> {
  /** When false, the rendered text cannot be selected or copied. */
  allowCopy?: boolean;
}

/**
 * Read-only renderer for stored rich text.
 *
 * It renders static markup and deliberately does not instantiate an editor. An
 * editor derives its own model from whatever is written into it and drops
 * anything it has no rule for, so a viewer built on one shows strictly less
 * than what was stored. Static markup shows exactly what survived sanitizing.
 *
 * Content passes through two steps, in this order: sanitize, which decides what
 * is allowed to exist at all, then normalize, which rewrites the previous
 * editor's markup into the shape the current one produces. Sanitizing has to
 * see the untrusted string first.
 */
const RichTextViewer: FC<RichTextViewerProps> = ({
  className,
  children,
  allowCopy = true,
  ...restOfProps
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  const html = useMemo(() => {
    const raw =
      children === null || children === undefined ? "" : String(children);
    return normalizeQuillHtml(sanitizeHtml(raw)).html;
  }, [children]);

  // Sanitizing needs a DOM, so the first paint stays empty and the content is
  // committed on the client. Rendering the server-side fallback instead would
  // leave a hydration mismatch React cannot repair for raw HTML.
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) {
      return;
    }

    for (const block of container.querySelectorAll<HTMLElement>("pre code")) {
      const language = [...block.classList]
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length);

      const source = block.textContent ?? "";
      if (!source || !language || !hljs.getLanguage(language)) {
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

  return (
    <div className={cn(className, "rich-text-viewer")} {...restOfProps}>
      <div
        ref={contentRef}
        className={cn("rich-text-content", !allowCopy && "select-none")}
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: isMounted ? html : "" }}
      />
    </div>
  );
};

export default RichTextViewer;
