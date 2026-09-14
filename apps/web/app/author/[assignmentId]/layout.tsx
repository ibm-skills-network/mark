import type { ReactNode } from "react";
import AuthorAccess from "@/components/AuthorAccess";

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const awbUrl =
    process.env.AWB_URL ||
    (process.env.APP_ENV === "staging"
      ? "https://author.staging.skills.network"
      : "https://author.skills.network");
  return (
    <AuthorAccess
      key={assignmentId}
      assignmentId={Number(assignmentId)}
      awbUrl={awbUrl}
      providerId={process.env.AWB_MARK_PROVIDER_ID}
    >
      {children}
    </AuthorAccess>
  );
}
