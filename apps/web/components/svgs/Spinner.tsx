import { cn } from "@/lib/strings";
import type { ComponentPropsWithoutRef, FC } from "react";

type Props = ComponentPropsWithoutRef<"svg">;

const Spinner: FC<Props> = (props) => {
  const { className, ...restOfProps } = props;

  return (
    <svg
      fill="none"
      className={cn("w-6 animate-spin", className)}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      {...restOfProps}
    >
      <path
        clipRule="evenodd"
        d="M15.165 8.53a.5.5 0 01-.404.58A7 7 0 1023 16a.5.5 0 011 0 8 8 0 11-9.416-7.874.5.5 0 01.58.404z"
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
};

export default Spinner;
