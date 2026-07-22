import Loading from "@/components/Loading";
import React, { FC } from "react";

interface LoadingPageProps {
  animationData: object;
}
const LoadingPage: FC<LoadingPageProps> = ({ animationData }) => {
  return <Loading animationData={animationData} />;
};

export default LoadingPage;
