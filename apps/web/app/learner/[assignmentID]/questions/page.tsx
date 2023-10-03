import { createAttempt, getAttempt, getAttempts } from "@/lib/talkToBackend";
import { useLearnerStore } from "@/stores/learner";
import QuestionPage from "@learnerComponents/Question";
import { redirect } from "next/navigation";

interface Props {
  params: { assignmentId: string };
}

async function LearnerLayout(props: Props) {
  const { params } = props;
  const assignmentId = parseInt(params.assignmentId);
  // check if we have the assignment details in the store
  // if not, redirect to the assignment overview page
  // if (useLearnerStore.getState().assignmentDetails?.id !== assignmentId) {
  //   redirect(`/learner/${assignmentId}`);
  // }
  const listOfAttempts = await getAttempts(assignmentId);
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
    : await createAttempt(assignmentId);
  console.log("attemptId", attemptId);
  // get the questions for the assignment from the attemptId
  const attempt = await getAttempt(assignmentId, attemptId);
  console.log("attempt", attempt);
  return (
    <main className="p-24 grid grid-cols-4 gap-x-5">
      <QuestionPage attempt={attempt} assignmentId={assignmentId} />
    </main>
  );
}

export default LearnerLayout;
