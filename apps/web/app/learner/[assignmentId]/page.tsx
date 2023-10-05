import ErrorPage from "@/components/ErrorPage";
import { LearnerAssignmentState } from "@/config/types";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import { headers } from "next/headers";
import AboutTheAssignment from "../(components)/AboutTheAssignment";

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
  const listOfAttempts = await getAttempts(assignmentId, cookie);
  console.log("listOfAttempts", listOfAttempts);
  // if the number of attempts of the assignment is equals to the assignment's max attempts, then the assignment state is "completed"
  let assignmentState: LearnerAssignmentState = "not-started";
  if (listOfAttempts.length === assignment.numAttempts) {
    assignmentState = "completed";
  } else {
    // check if there are any attempts that are not submitted and have not expired
    const unsubmittedAssignment = listOfAttempts.find(
      (attempt) =>
        attempt.submitted === false &&
        // if the assignment does not expire, then the expiresAt is null
        (attempt.expiresAt === null ||
          Date.now() < Date.parse(attempt.expiresAt))
    );
    if (unsubmittedAssignment) {
      assignmentState = "in-progress";
    }
  }

  return (
    <main className="p-24 rounded-lg shadow-md h-full">
      <AboutTheAssignment
        assignment={assignment}
        assignmentState={assignmentState}
      />
    </main>
  );
}

export default IntroductionPage;
