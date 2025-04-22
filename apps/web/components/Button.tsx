import { cn } from "@/lib/strings";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"button"> {
  version?: "primary" | "secondary" | "tertiary";
  LeftIcon?: React.FC<React.SVGProps<SVGSVGElement>>;
  RightIcon?: React.FC<React.SVGProps<SVGSVGElement>>;
  err?: boolean;
}

const Button = forwardRef<HTMLButtonElement, Props>(
  ({ err, ...props }, ref) => {
    const {
      onClick,
      disabled,
      children,
      className,
      LeftIcon,
      RightIcon,
      version = "primary",
    } = props;

    return (
      <button
        ref={err ? null : ref}
        onClick={onClick}
        disabled={disabled}
        type="button"
        className={cn(
          {
            "btn-primary": version === "primary",
            "btn-secondary": version === "secondary",
            "btn-tertiary": version === "tertiary",
          },
          "group",
          className,
        )}
      >
        {LeftIcon && (
          <LeftIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
        )}
        {children}
        {RightIcon && (
          <RightIcon className="w-5 h-5 group-hover:translate-x-0.5 transition-transform duration-200 disabled:opacity-50" />
        )}
      </button>
    );
  },
);

Button.displayName = "Button";
export default Button;
