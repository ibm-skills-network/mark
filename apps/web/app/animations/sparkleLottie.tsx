"use client";

import { LottieRefCurrentProps } from "lottie-react";
import dynamic from "next/dynamic";
import {
  useEffect,
  useRef,
  type ComponentPropsWithoutRef,
  type FC,
} from "react";
import sparkle from "./sparkle";

const Lottie = dynamic(() => import("lottie-react"), { ssr: false });

type Props = ComponentPropsWithoutRef<"div">;

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
