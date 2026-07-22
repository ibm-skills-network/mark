"use client";

import Lottie from "lottie-react";
import React, { useEffect, useState } from "react";

interface LoadingProps {
  animationData: object;
}
const Loading: React.FC<LoadingProps> = ({ animationData }) => {
  // Keep the server render and the client's first render identical. Using a
  // `dynamic(..., { ssr: false })` wrapper here makes Next abort the surrounding
  // Suspense boundary on every loading render, which React reports as error 419.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75">
      {mounted ? (
        <Lottie
          className="h-44 scale-150"
          loop
          autoplay
          animationData={animationData}
        />
      ) : (
        <div className="h-44 w-44 scale-150" aria-label="Loading" role="status" />
      )}
    </div>
  );
};

export default Loading;
