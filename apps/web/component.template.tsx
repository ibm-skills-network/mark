import { type ComponentPropsWithoutRef } from "react";

type Props = ComponentPropsWithoutRef<"div">;

function Component(props: Props) {
  return <div {...props}>Component</div>;
}

export default Component;
