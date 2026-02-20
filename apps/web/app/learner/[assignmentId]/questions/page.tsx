"use strict";

import animationData from "@/animations/LoadSN.json";
import LoadingPage from "@/app/loading";
import { Suspense } from "react";
import LearnerLayout from "./LearnerLayout";

interface Props {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ authorMode?: string }>;
}

export default async function Page(props: Props) {
  const resolvedParams = await props.params;
  const resolvedSearchParams = await props.searchParams;
  return (
    <LearnerLayout
      params={resolvedParams}
      searchParams={resolvedSearchParams}
    />
  );
}
