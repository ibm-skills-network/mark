import { type FC, type ReactNode } from "react";

interface Props {
  direction?: "top" | "bottom" | "left" | "right";
  content: string;
  delay?: number;
  children: ReactNode;
  disabled?: boolean;
  distance?: number;
}

const Tooltip: FC<Props> = (props) => {
  const {
    direction = "bottom",
    content,
    delay = 500,
    children,
    disabled = false,
    distance = 0,
  } = props;

  return (
    <div className="group">
      {children}
      <div className="relative flex items-center justify-center group">
        {!disabled && (
          <span
            className={`absolute rounded-lg z-50 w-auto p-2 text-xs font-bold capitalize transition-all duration-100 scale-0 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 min-w-max group-hover:scale-100
              group-hover:delay-${delay} ${
              (
                direction === "left"
                  ? `right-[${distance}rem] origin-right`
                  : direction === "right"
              )
                ? `left-[${distance}rem] origin-left`
                : ""
            } ${
              (
                direction === "top"
                  ? `bottom-[${distance}rem] origin-bottom`
                  : direction === "bottom"
              )
                ? `top-[${distance}rem] origin-top`
                : ""
            }`}
          >
            {content}
          </span>
        )}
      </div>
    </div>
  );
};

export default Tooltip;
