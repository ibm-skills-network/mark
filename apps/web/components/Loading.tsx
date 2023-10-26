import { type ComponentPropsWithoutRef } from "react";
import Spinner from "./svgs/Spinner";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Loading(props: Props) {
  const {} = props;

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="flex justify-center items-center gap-x-1 text-sm text-gray-700">
        <Spinner className="" />
        <div>Loading ...</div>
      </div>
    </div>
  );
}

export default Loading;
