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
  allowCopy?: boolean;
}

// Static rendering avoids dropping content outside the editor schema.
const RichTextViewer: FC<RichTextViewerProps> = ({
  className,
  children,
  allowCopy = true,
  ...restOfProps
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isMounted, setIsMounted] = useState(false);

  // Wait for the DOM so SSR and hydration both start empty.
  const html = useMemo(
    () => (isMounted ? prepareStoredHtml(String(children ?? "")) : ""),
    [children, isMounted],
  );

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

      // highlight.js escapes the source before producing markup.
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
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
};

export default RichTextViewer;
