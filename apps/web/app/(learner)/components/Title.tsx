import React from "react";

interface Props {
  text: string;
  level?: string;
}

function Title(props: Props) {
  const { text, level = "1" } = props;

  const Tag = `h${level}` as keyof JSX.IntrinsicElements;
  return (
    <Tag
      className={`text-${
        level === "1" ? "3xl" : level === "2" ? "2xl" : "xl"
      } font-bold text-black`}
    >
      {text}
    </Tag>
  );
}

export default Title;