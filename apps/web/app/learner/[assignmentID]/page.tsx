import ErrorPage from "@/components/ErrorPage";
import { getAssignment } from "@/lib/talkToBackend";
import AboutTheAssignment from "../(components)/AboutTheAssignment";

interface Props {
  params: { assignmentId: string };
}

async function IntroductionPage(props: Props) {
  const { params } = props;
  const assignmentId = parseInt(params.assignmentId);
  const assignment = await getAssignment(assignmentId);
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
