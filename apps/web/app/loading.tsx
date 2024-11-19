"use client";
import React, { FC } from "react";
import dynamic from "next/dynamic";

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
