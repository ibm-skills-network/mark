import ErrorPage from "@/components/ErrorPage";
import { getAssignment } from "@/lib/talkToBackend";
import AboutTheAssignment from "../(components)/AboutTheAssignment";
import { headers } from "next/headers";

interface Props {
  params: { assignmentId: string };
}

async function IntroductionPage(props: Props) {
  const headerList = headers();
  const cookie = headerList.get("cookie");
  const { params } = props;
  const assignmentId = ~~params.assignmentId;
  const assignment = await getAssignment(assignmentId, cookie);
  // go to the error page if the assignment is not found
  if (!assignment) {
    return <ErrorPage error={"Assignment not found"} />;
  }

  return (
    <main className="p-24 rounded-lg shadow-md h-full">
      <AboutTheAssignment assignment={assignment} />
    </main>
  );
}

export default IntroductionPage;
