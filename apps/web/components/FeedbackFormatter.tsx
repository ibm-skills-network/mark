"use client";

import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef, FC } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";

import { cn } from "@/lib/strings";
import { useEffect } from "react";

type Props = ComponentPropsWithoutRef<"div">;

const MdViewer = dynamic(
  () =>
    import("@uiw/react-md-editor").then((mod) => {
      return mod.default.Markdown;
    }),
  { ssr: false },
);

const FeedbackFormatter: FC<Props> = (props) => {
  const { className, children, ...restOfProps } = props;
  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
    .wmde-markdown, .markdown-viewer {
      font-family: "IBM Plex Sans", sans-serif !important;
      font-size: 16px !important;
      font-weight: 600 !important;
      line-height: 1.3 !important;
    }
      .wmde-markdown li[data-list="bullet"],
   .markdown-viewer li[data-list="bullet"] {
     list-style-type: disc !important;
     display: list-item !important;
     margin-left: 1.5em !important;
   }
    .wmde-markdown li[data-list="ordered"],
    .markdown-viewer li[data-list="ordered"] {
      list-style-type: decimal !important;
      display: list-item !important;
      margin-left: 1.5em !important;
    }

    .wmde-markdown p,
    .wmde-markdown li,
    .wmde-markdown blockquote,
    .markdown-viewer p,
    .markdown-viewer li,
    .markdown-viewer blockquote {
      margin: 0.1em 0 !important; 
      padding: 0 !important;
    }

    .wmde-markdown ul,
    .wmde-markdown ol,
    .markdown-viewer ul,
    .markdown-viewer ol {
      padding-left: 1em !important; 
      margin: 0.1em 0 !important; 
    }

    .wmde-markdown pre, 
    .wmde-markdown code,
    .markdown-viewer pre,
    .markdown-viewer code {
      white-space: pre-wrap !important;
      line-height: 1 !important; 
      padding: 0.1em 0.2em !important;
      overflow-wrap: break-word !important;
      background-color: #f5f5f5 !important;
    }

    .wmde-markdown h1, .wmde-markdown h2, .wmde-markdown h3,
    .wmde-markdown h4, .wmde-markdown h5, .wmde-markdown h6,
    .markdown-viewer h1, .markdown-viewer h2, .markdown-viewer h3,
    .markdown-viewer h4, .markdown-viewer h5, .markdown-viewer h6 {
      margin: 0.1em 0 !important; 
      padding: 0 !important;
    }
    
    .wmde-markdown li > p, 
    .markdown-viewer li > p {
      margin: 0 !important; 
    }

    .wmde-markdown .hljs, .markdown-viewer .hljs {
      padding: 0.2em !important;
      font-size: 0.95em !important;
  `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <MdViewer
      className={cn(className, "whitespace-pre-wrap", "markdown-viewer")}
      style={{
        overflowWrap: "anywhere",
        fontFamily: "IBM Plex Sans, sans-serif",
        backgroundColor: "transparent",
      }}
      {...restOfProps}
      source={children as string}
      rehypePlugins={[rehypeHighlight]}
      skipHtml={false}
    />
  );
};

export default FeedbackFormatter;
