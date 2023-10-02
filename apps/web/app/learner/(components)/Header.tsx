"use client";

import { submitAssignment } from "@/lib/talkToBackend";
import { useLearnerStore } from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import Breadcrumbs from "./Breadcrumbs";
import Button from "./Button";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;
  const [activeAssignmentId, activeAttemptId] = useLearnerStore((state) => [
    state.activeAssignmentId,
    state.activeAttemptId,
  ]);

  async function handleSubmitAssignment() {
    const confirmSubmit = confirm("Are you sure you want to submit?");
    if (confirmSubmit) {
      const grade = await submitAssignment(activeAssignmentId, activeAttemptId);
      console.log("grade", grade);
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
        <Button className="" onClick={handleSubmitAssignment}>
          Submit assignment
        </Button>
      )}
    </header>
  );
}

export default LearnerHeader;
