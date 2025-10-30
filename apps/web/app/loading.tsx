"use client";

import dynamic from "next/dynamic";
import React, { FC } from "react";

const DynamicLoading = dynamic<{ animationData: any }>(
  () => import("@/components/Loading"),
  {
    ssr: false,
  },
);
interface LoadingPageProps {
  animationData: object;
}
const LoadingPage: FC<LoadingPageProps> = ({ animationData }) => {
  return <DynamicLoading animationData={animationData} />;
};

export default LoadingPage;
