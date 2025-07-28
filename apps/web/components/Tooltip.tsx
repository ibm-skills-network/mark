import { cn } from "@/lib/strings";
import type { ComponentPropsWithoutRef, FC, ReactNode } from "react";

interface Props extends Omit<ComponentPropsWithoutRef<"div">, "content"> {
  direction?: "x" | "y";
  content: ReactNode;
  delay?: number;
  disabled?: boolean;
  distance?: number;
  up?: number;
  maxWidth?: number;
}

const Tooltip: FC<Props> = (props) => {
  const {
    direction = "y",
    content,
    delay = 500,
    children,
    disabled = false,
    distance = 1.5,
    className,
    maxWidth,
    ...restOfProps
  } = props;
  function getClassNamesFromDirectionAndDistance() {
    switch (direction) {
      case "x":
        return classNamesFromXDistance();
      case "y":
        return classNamesFromYDistance();
    }
  }

  const classNamesFromXDistance = () => {
    if (distance < 0) {
      return "origin-right";
    }
    if (distance > 0) {
      return "origin-left";
    }
    return "origin-center";
  };

  const classNamesFromYDistance = () => {
    if (distance > 0) {
      return "origin-bottom";
    }
    if (distance < 0) {
      return "origin-top";
    }
    return "origin-center";
  };

  return (
    <div className={cn("group/tooltip", className)} {...restOfProps}>
      {children}
      <div className="relative flex items-center justify-center group/tooltip">
        {!disabled && (
          <span
            style={
              direction === "x"
                ? { left: `${distance}rem`, top: `${props.up}rem` }
                : { bottom: `${distance}rem` }
            }
            className={cn(
              "absolute rounded-lg z-9000 w-auto p-2 text-xs font-bold transition-all duration-100 scale-0 dark:bg-white bg-gray-950 dark:text-gray-800 text-slate-100 min-w-max group-hover/tooltip:scale-100 text-wrap",
              `group-hover/tooltip:delay-${delay}`,
              maxWidth ? `max-w-[${maxWidth}px]` : "max-w-xs",
              getClassNamesFromDirectionAndDistance(),
            )}
          >
            {content}
          </span>
        )}
      </div>
    </div>
  );
};

export default Tooltip;
