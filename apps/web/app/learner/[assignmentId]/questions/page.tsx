"use strict";
import { Suspense } from "react";
import LearnerLayout from "./LearnerLayout";
import LoadingPage from "@/app/loading";
import animationData from "@/animations/LoadSN.json";

interface Props {
  params: { assignmentId: string };
  searchParams: { authorMode?: string };
}

export default function Page(props: Props) {
  return (
    <Suspense fallback={<LoadingPage animationData={animationData} />}>
      <LearnerLayout {...props} />
    </Suspense>
  );
}
