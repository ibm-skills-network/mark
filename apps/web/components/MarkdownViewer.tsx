"use client";

import { cn } from "@/lib/strings";
import dynamic from "next/dynamic";
import type { ComponentPropsWithoutRef, FC } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {}
const MdViewer = dynamic(
  () =>
    import("@uiw/react-md-editor").then((mod) => {
      return mod.default.Markdown;
    }),
  { ssr: false }
);
const MarkdownViewer: FC<Props> = (props) => {
  const { className, children, ...restOfProps } = props;

  return (
    <MdViewer
      className={cn("whitespace-pre-wrap", className)}
      {...restOfProps}
      source={children as string}
    />
  );
};

export default MarkdownViewer;
