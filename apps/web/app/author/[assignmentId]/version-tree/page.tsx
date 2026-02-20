import { VersionTreeView } from "@/components/version-control/VersionTreeView";

interface Props {
  params: Promise<{ assignmentId: string }>;
}

export default async function VersionTreePage({ params }: Props) {
  const resolvedParams = await params;
  return <VersionTreeView assignmentId={resolvedParams.assignmentId} />;
}
