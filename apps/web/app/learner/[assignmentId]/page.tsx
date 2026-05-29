import SessionExpired from "@/components/SessionExpired";
import { getUser } from "@/lib/talkToBackend";
import { headers } from "next/headers";
import AuthFetchToAbout from "./AuthFetchToAbout";

interface Props {
  params: Promise<{ assignmentId: string }>;
  searchParams: Promise<{ submissionTime?: string }>;
}

async function Component(props: Props) {
  const { params } = props;
  const resolvedParams = await params;
  const { assignmentId } = resolvedParams;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie") || "";
  try {
    const user = await getUser(cookieHeader);
    const role = user?.role;

    return (
      <AuthFetchToAbout
        assignmentId={Math.trunc(Number(assignmentId))}
        role={role}
        cookie={cookieHeader}
      />
    );
  } catch (error) {
    console.error("Learner page error:", error);
    return <SessionExpired />;
  }
}

export default Component;
