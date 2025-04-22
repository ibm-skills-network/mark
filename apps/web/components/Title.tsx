import { cn } from "@/lib/strings";
import type { ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"h1"> {
  level?: 1 | 2 | 3 | 4 | 5;
}

function Title(props: Props) {
  const { children, level = 1, className } = props;

  const Tag = `h${level.toString()}` as keyof JSX.IntrinsicElements;
  return (
    <Tag
      className={cn(
        { "text-4xl": level === 1 },
        { "text-3xl": level === 2 },
        { "text-2xl": level === 3 },
        { "text-xl": level === 4 },
        { "text-lg": level === 5 },
        "font-bold text-gray-900",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export default Title;
