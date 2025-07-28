"use strict";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import { Suspense } from "react";
import LearnerLayout from "./LearnerLayout";

interface Props {
  params: { assignmentId: string };
  searchParams: { authorMode?: string };
}

export default function Page(props: Props) {
  return <LearnerLayout {...props} />;
}
