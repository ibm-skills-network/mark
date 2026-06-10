"use client";

import { useParams } from "next/navigation";
import { AssignmentInsightsContent } from "@/components/insights/AssignmentInsightsContent";

export default function AdminAssignmentInsightsPage() {
  const params = useParams();
  const assignmentId = Number(params?.id);
  if (!Number.isFinite(assignmentId)) {
    return null;
  }
  return <AssignmentInsightsContent assignmentId={assignmentId} mode="admin" />;
}
