"use client";
import React from "react";
import Loading from "@components/Loading";
import dynamic from "next/dynamic";
const DynamicLoading = dynamic(() => import("@/components/Loading"), {
  ssr: false,
});

const LoadingPage: React.FC = () => {
  return <DynamicLoading />;
};

export default LoadingPage;
