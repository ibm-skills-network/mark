import {
  useRef,
  type ComponentPropsWithoutRef,
  type FC,
  useEffect,
} from "react";
import sparkle from "./sparkle";
import Lottie, { type LottieRefCurrentProps } from "lottie-react";
interface Props extends ComponentPropsWithoutRef<"div"> {}

const Component: FC<Props> = () => {
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);

  useEffect(() => {
    lottieRef.current?.setSpeed(0.4);
  }, []);

  return (
    <Lottie
      lottieRef={lottieRef}
      className="absolute w-5 h-6"
      animationData={sparkle}
      rendererSettings={{ preserveAspectRatio: "xMidYMid slice" }}
      autoplay
      loop
    />
  );
};

export default Component;
