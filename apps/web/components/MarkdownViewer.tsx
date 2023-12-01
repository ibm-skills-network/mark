"use client";

import dynamic from "next/dynamic";
import { type ComponentPropsWithoutRef, type FC } from "react";
import { twMerge } from "tailwind-merge";

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
      className={twMerge(className, "whitespace-pre-wrap")}
      {...restOfProps}
      source={children as string}
    />
  );
};

export default MarkdownViewer;
