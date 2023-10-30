import { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";

interface Props extends ComponentPropsWithoutRef<"div"> {
  leftStickySide?: ReactNode;
  mainContent: ReactNode;
  rightStickySide?: ReactNode;
}
function PageWithStickySides(props: Props) {
  const { className, leftStickySide, mainContent, rightStickySide } = props;

  return (
    <section className={twMerge("flex gap-x-4 mx-auto", className)}>
      <div className="sticky top-14 flex h-full flex-col gap-y-2">
        {leftStickySide}
      </div>
      <div className="flex-1">{mainContent}</div>
      <div className="sticky top-14 flex h-full flex-col gap-y-2">
        {rightStickySide}
      </div>
    </section>
  );
}

export default PageWithStickySides;
