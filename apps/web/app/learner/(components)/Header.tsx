"use client";

import { submitAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Button from "./Button";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;
  const [questions, activeAttemptId] = useLearnerStore((state) => [
    state.questions,
    state.activeAttemptId,
  ]);
  const assignmentDetails = useAssignmentDetails(
    (state) => state.assignmentDetails
  );
  const assignmentId = assignmentDetails?.id;
  const passingGrade = assignmentDetails?.passingGrade;
  const userSubmittedAnyQuestion = questions.some(
    (question) => question.questionResponses.length > 0
  );

  async function handleSubmitAssignment() {
    const confirmSubmit = confirm("Are you sure you want to submit?");
    if (confirmSubmit) {
      const grade = await submitAssignment(assignmentId, activeAttemptId);
      alert(`Your grade is ${grade * 100}/100
${grade >= passingGrade ? "You passed!" : "You failed."}`);
    }
  }

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 flex justify-between">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title
            text="Auto-Graded Assignment Creator"
            className="text-lg font-semibold"
          />
          {/* TODO: add back when needed */}
          {/* <div>
            <Breadcrumbs />
          </div> */}
        </div>
      </div>
      {activeAttemptId && (
        <Button
          disabled={!userSubmittedAnyQuestion}
          className="disabled:opacity-70"
          onClick={handleSubmitAssignment}
        >
          Submit assignment
        </Button>
      )}
    </header>
  );
}

export default LearnerHeader;
