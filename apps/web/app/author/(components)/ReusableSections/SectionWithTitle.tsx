import Title from "@/components/Title";
import { cn } from "@/lib/strings";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import type { ComponentPropsWithoutRef, ElementType } from "react";

export function SectionWithTitle<T extends ElementType = "section">(
  props: Omit<ComponentPropsWithoutRef<T>, "as" | "className"> & {
    description?: string | JSX.Element;
    required?: boolean;
    as?: T;
    className?: string;
    IconForTitle?: ElementType;
  },
) {
  const {
    as,
    title,
    description,
    className,
    children,
    IconForTitle,
    required = false,
    ...rest
  } = props;
  const Component = as ?? "section";
  return (
    <Component
      className="group relative flex flex-col items-start gap-y-4 px-8 py-6 max-w-full bg-white rounded border border-solid max-md:px-5 "
      {...rest}
    >
      <div className="flex flex-col gap-y-1.5">
        <Title
          className={cn("flex text-2xl font-bold text-black max-md:flex-wrap")}
        >
          {IconForTitle && (
            <IconForTitle className="shrink-0 my-auto w-6 aspect-square text-gray-500" />
          )}
          <span
            className={cn(
              required && "after:text-violet-600 after:content-['*']",
              IconForTitle && "pl-1.5",
            )}
          >
            {title}
          </span>
        </Title>
        <p className="text-base leading-6 text-gray-600 font-[450]">
          {description}
        </p>
      </div>
      {/* <Title
						text={title}
						level={5}
						className={cn(
							"leading-6",
							required && "after:text-blue-400 after:content-['*']",
						)}
					/>
					{description && <p className="mt-2 text-gray-600">{description}</p>} */}
      {/* </div> */}
      {/* </div> */}
      <div className={cn("w-full", className)}>{children}</div>
    </Component>
  );
}

export default SectionWithTitle;
