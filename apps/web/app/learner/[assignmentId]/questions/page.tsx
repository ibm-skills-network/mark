import { createAttempt, getAttempt, getAttempts } from "@/lib/talkToBackend";
import QuestionPage from "@learnerComponents/Question";
import { headers } from "next/headers";

interface Props {
  params: { assignmentId: string };
}

async function LearnerLayout(props: Props) {
  const headerList = headers();
  const cookie = headerList.get("cookie");
  const { params } = props;
  const assignmentId = ~~params.assignmentId;
  const listOfAttempts = await getAttempts(assignmentId, cookie);
  console.log("listOfAttempts", listOfAttempts);
  // check if there are any attempts that are not submitted and have not expired
  const unsubmittedAssignment = listOfAttempts.find(
    (attempt) =>
      attempt.submitted === false &&
      // if the assignment does not expire, then the expiresAt is null
      (attempt.expiresAt === null || Date.now() < Date.parse(attempt.expiresAt))
  );
  // if there are no unsubmitted attempts, create a new attempt
  const attemptId = unsubmittedAssignment
    ? unsubmittedAssignment.id
    : await createAttempt(assignmentId, cookie);
  console.log("attemptId", attemptId);
  // get the questions for the assignment from the attemptId
  const attempt = await getAttempt(assignmentId, attemptId, cookie);
  console.log("attempt", attempt);
  return (
    <main className="p-24">
      <QuestionPage attempt={attempt} assignmentId={assignmentId} />
    </main>
  );
}

export default LearnerLayout;
