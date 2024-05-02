"use client";

import { submitAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Breadcrumbs from "./Breadcrumbs";
import Button from "./Button";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const router = useRouter();

  const [questions, activeAttemptId, submitAssignmentRef] = useLearnerStore((state) => [
    state.questions,
    state.activeAttemptId,
    state.submitAssignmentRef
  ]);
  const [assignmentDetails, setGrade] = useAssignmentDetails((state) => [
    state.assignmentDetails,
    state.setGrade,
  ]);
  const assignmentId = assignmentDetails?.id;
  const isInQuestionPage = pathname.includes("questions");
  const [title, setTitle] = useState<string>("Auto-Graded Assignment");
  useEffect(() => {
    if (assignmentDetails) {
      setTitle(assignmentDetails.name);
    }
  }, []);
  const userSubmittedAnyQuestion = questions.some(
    (question) => question.questionResponses.length > 0
  );
  async function handleSubmitAssignment() {
    const grade = await submitAssignment(assignmentId, activeAttemptId);
    if (typeof grade !== "number" || grade < 0 || grade > 1) {
      toast.error("Failed to submit assignment.");
      return;
    }
    setGrade(grade * 100);
    // ${grade >= passingGrade ? "You passed!" : "You failed."}`);
    const currentTime = Date.now();
    console.log("currentTime", currentTime);
    router.push(`/learner/${assignmentId}?submissionTime=${currentTime}`);
  }

  return (
    <header className="border-b border-gray-300 w-full px-6 py-6 flex justify-between">
      <div className="flex">
        <div className="flex flex-col justify-center mr-4">
          <SNIcon />
        </div>
        <div>
          <Title text={title} className="text-lg font-semibold" />
          {pathname.includes("questions") && (
            <Breadcrumbs
              homeHref={pathname.replace(/\/questions.*/, "")}
              pages={[
                {
                  name: "Questions",
                  href: pathname,
                  current: true,
                },
              ]}
            />
          )}
        </div>
      </div>
      {activeAttemptId && isInQuestionPage && (
        <Button
          ref={submitAssignmentRef}
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
