"use client";

import Lottie from "lottie-react";
import React, { useEffect, useState } from "react";

interface LoadingProps {
  animationData: object;
}
const Loading: React.FC<LoadingProps> = ({ animationData }) => {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Always render the container div for consistent SSR/CSR
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900 bg-opacity-75">
      {isClient && (
        <Lottie
          className="h-44 scale-150"
          loop
          autoplay
          animationData={animationData}
        />
      )}
    </div>
  );
};

export default Loading;
