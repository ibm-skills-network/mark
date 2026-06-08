"use client";

import { useParams } from "next/navigation";
import { AssignmentInsightsContent } from "@/components/insights/AssignmentInsightsContent";

export default function AuthorAssignmentInsightsPage() {
  const params = useParams();
  const assignmentId = Number(params?.assignmentId);
  if (!Number.isFinite(assignmentId)) {
    return null;
  }
  return (
    <AssignmentInsightsContent assignmentId={assignmentId} mode="author" />
  );
}
