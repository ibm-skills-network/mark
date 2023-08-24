"use client";

import React from "react";
import { twMerge } from "tailwind-merge";

interface Props extends React.ComponentPropsWithoutRef<"h1"> {
  text: string;
  level?: string;
}

function Title(props: Props) {
  const { text, level = "1", className } = props;

  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  return (
    <Tag
      className={twMerge(
        `text-${
          level === "1" ? "3xl" : level === "2" ? "2xl" : "xl"
        } font-bold text-black`,
        className
      )}
    >
      {text}
    </Tag>
  );
}

export default Title;
