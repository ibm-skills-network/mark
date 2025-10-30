import { getUser } from "@/lib/talkToBackend";
import { headers } from "next/headers";
import AuthFetchToAbout from "./AuthFetchToAbout";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

async function Component(props: Props) {
  const { params } = props;
  const { assignmentId } = params;
  const headerList = headers();
  const cookieHeader = headerList.get("cookie") || "";
  const user = await getUser(cookieHeader);
  const role = user?.role;

  return (
    <AuthFetchToAbout
      assignmentId={~~assignmentId}
      role={role}
      cookie={cookieHeader}
    />
  );
}

export default Component;
