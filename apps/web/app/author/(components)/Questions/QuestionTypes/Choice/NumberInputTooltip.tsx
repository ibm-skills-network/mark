import { cn } from "@/lib/strings";
import { PlusIcon } from "@heroicons/react/24/solid";
import type { ComponentPropsWithoutRef, FC, ReactNode } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  incrementPoints: () => void;
  decrementPoints: () => void;
  disableIncrement?: boolean;
  disableDecrement?: boolean;
  delay?: number;
  disabled?: boolean;
}

const Tooltip: FC<Props> = (props) => {
  const {
    children,
    disabled = false,
    className,
    incrementPoints,
    decrementPoints,
    disableIncrement = false,
    disableDecrement = false,
    ...restOfProps
  } = props;

  return (
    <div className={cn("group/tooltip", className)} {...restOfProps}>
      {children}
      <div className="relative flex items-center justify-center">
        {!disabled && (
          <div
            style={{ bottom: "1.5rem" }}
            className="absolute rounded-full z-50 w-auto p-1 text-xs font-bold transition-all duration-100 scale-0 bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 min-w-max group-hover/tooltip:scale-100 origin-bottom  group-hover/tooltip:delay-0 delay-300"
          >
            <div className="flex items-center justify-between">
              <button
                disabled={disableDecrement}
                type="button"
                className="focus:outline-none rounded-full p-1 hover:text-gray-300 disabled:text-gray-500"
                onClick={decrementPoints}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M18 12H6" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              <button
                disabled={disableIncrement}
                type="button"
                className="focus:outline-none rounded-full p-1 hover:text-gray-300 disabled:text-gray-500"
                onClick={incrementPoints}
              >
                <PlusIcon className="w-6" strokeWidth={3} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Tooltip;
