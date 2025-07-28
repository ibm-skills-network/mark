"use client";

import Lottie from "lottie-react";
import React from "react";

interface LoadingProps {
  animationData: object;
}
const Loading: React.FC<LoadingProps> = ({ animationData }) => {
  if (typeof document === "undefined") {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75">
      <Lottie
        className="h-44 scale-150"
        loop
        autoplay
        animationData={animationData}
      />
    </div>
  );
};

export default Loading;
