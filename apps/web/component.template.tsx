import { type ComponentPropsWithoutRef } from "react";

interface Props extends ComponentPropsWithoutRef<"div"> {}

function Component(props: Props) {
  const {} = props;

  return <div className="">Component</div>;
}

export default Component;
