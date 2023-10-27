import ErrorPage from "@/components/ErrorPage";
import { LearnerAssignmentState } from "@/config/types";
import { getAssignment, getAttempts } from "@/lib/talkToBackend";
import AboutTheAssignment from "@learnerComponents/AboutTheAssignment";
import SuccessPage from "@learnerComponents/SuccessPage";
import { headers } from "next/headers";

interface Props {
  params: { assignmentId: string };
  searchParams: { submissionTime?: string };
}

async function Component(props: Props) {
  const { params, searchParams } = props;
  const { submissionTime } = searchParams;
  // DON'T USE ~~ TO CONVERT TO INT, CAUSES THE NUMBER TO BECOME SMALLER THAN IT SHOULD BE
  const submissionTimeInt = parseInt(submissionTime);
  const currentDateInThisPage = Date.now();
  const headerList = headers();
  const cookie = headerList.get("cookie");
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
    <main className="p-20 flex flex-col gap-y-14">
      {/* if submission tims is within 10 seconds of now, show the submitted page, and it can't be greater than the current date in this page */}
      {submissionTime &&
      currentDateInThisPage - submissionTimeInt < 10000 &&
      currentDateInThisPage > submissionTimeInt ? (
        <SuccessPage />
      ) : (
        <AboutTheAssignment
          assignment={assignment}
          assignmentState={assignmentState}
        />
      )}
    </main>
  );
}

export default Component;
