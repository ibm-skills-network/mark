import ErrorPage from "@/components/ErrorPage";
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
    return (
      <ErrorPage
        statusCode={401}
        error={
          "Oopsies! It looks like you tried to launch this assignment incorrectly. Please open the assignment from your LMS (Coursera, OpenEdx, Author Workbench, or yourLearning). If the problem keeps happening, contact your instructor or use the chatbot to open a support ticket."
        }
      />
    );
  }
}

export default Component;
