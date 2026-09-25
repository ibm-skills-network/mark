"use client";

import hljs from "highlight.js";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";

import { prepareStoredHtml } from "@/lib/rich-text/prepare-stored-html";
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
 * Content goes through `prepareStoredHtml`, which owns the sanitize-then-
 * normalize order.
 */
const RichTextViewer: FC<RichTextViewerProps> = ({
  className,
  children,
  allowCopy = true,
  ...restOfProps
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  const html = useMemo(
    () =>
      prepareStoredHtml(
        children === null || children === undefined ? "" : String(children),
      ),
    [children],
  );

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
