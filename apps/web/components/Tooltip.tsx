import { cn } from "@/lib/strings";
import type { ComponentPropsWithoutRef, FC, ReactNode } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  direction?: "x" | "y";
  content: string;
  delay?: number;
  children: ReactNode;
  disabled?: boolean;
  distance?: number;
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
    if (distance > 0) {
      return "origin-right";
    }
    if (distance < 0) {
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
                ? { left: `${distance}rem` }
                : { bottom: `${distance}rem` }
            }
            className={cn(
              "absolute rounded-lg z-50 w-auto p-2 text-xs font-bold transition-all duration-100 scale-0 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 min-w-max group-hover/tooltip:scale-100",
              `group-hover/tooltip:delay-${delay}`,
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
