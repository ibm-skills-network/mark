import { ErrorScreen, statusFromError } from "@/lib/error-screen";
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
    // getUser throws Error("Unauthorized") for 401; statusFromError maps that to
    // 401 -> SessionExpired and anything else to a generic ErrorPage rather than
    // telling every failure to "reload to sign back in".
    return <ErrorScreen status={statusFromError(error)} />;
  }
}

export default Component;
