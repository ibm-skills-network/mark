"use client";
import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef, FC } from "react";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css"; // Import a Highlight.js theme
import { useEffect } from "react";
import { cn } from "@/lib/strings";

interface Props extends ComponentPropsWithoutRef<"div"> {}

const MdViewer = dynamic(
  () =>
    import("@uiw/react-md-editor").then((mod) => {
      return mod.default.Markdown;
    }),
  { ssr: false },
);

const MarkdownViewer: FC<Props> = (props) => {
  const { className, children, ...restOfProps } = props;

  useEffect(() => {
    const style = document.createElement("style");
    style.innerHTML = `
      .markdown-viewer .ql-code-block-container .ql-ui {
        display: none;
      }
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
        overflowY: "auto",
        maxHeight: "200px",
        backgroundColor: "transparent",
      }}
      {...restOfProps}
      source={children as string}
      rehypePlugins={[rehypeHighlight]}
    />
  );
};

export default MarkdownViewer;
