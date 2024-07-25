import { cn } from "@/lib/strings";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"button"> {
  err?: boolean;
}

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ err, ...props }, ref) => {
    const { onClick, disabled, children, className } = props;

    return (
      <button
        ref={err ? null : ref}
        onClick={onClick}
        disabled={disabled}
        type="button"
        className={cn(
          "rounded-md transition bg-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm enabled:hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600",
          className,
        )}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
export default Button;
