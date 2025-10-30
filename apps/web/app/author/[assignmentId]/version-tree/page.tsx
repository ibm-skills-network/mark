"use client";

import { VersionTreeView } from "@/components/version-control/VersionTreeView";

interface Props {
  params: { assignmentId: string };
}

export default function VersionTreePage({ params }: Props) {
  return <VersionTreeView assignmentId={params.assignmentId} />;
}
