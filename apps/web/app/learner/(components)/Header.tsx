"use client";

import { submitAssignment } from "@/lib/talkToBackend";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import SNIcon from "@components/SNIcon";
import Title from "@components/Title";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import Breadcrumbs from "./Breadcrumbs";
import Button from "../../../components/Button";
import type { QuestionAttemptRequestWithId } from "@/config/types";
import { editedQuestionsOnly } from "@/lib/utils";

interface Props {}

function LearnerHeader(props: Props) {
  const {} = props;
  const pathname = usePathname();
  const router = useRouter();

  const [questions, setQuestion, activeAttemptId, submitAssignmentRef] =
    useLearnerStore((state) => [
      state.questions,
      state.setQuestion,
      state.activeAttemptId,
      state.submitAssignmentRef,
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

  async function handleSubmitAssignment() {
    const responsesForOnlyEditedQuestions = editedQuestionsOnly(questions);
    const responsesForQuestions: QuestionAttemptRequestWithId[] =
      responsesForOnlyEditedQuestions.map((q) => ({
        id: q.id,
        learnerTextResponse: q.learnerTextResponse || undefined,
        learnerUrlResponse: q.learnerUrlResponse || undefined,
        learnerChoices: q.learnerChoices || undefined,
        learnerAnswerChoice: q.learnerAnswerChoice || undefined,
        learnerFileResponse: q.learnerFileResponse || undefined,
      }));
    console.log("responsesForQuestions", responsesForQuestions);
    const res = await submitAssignment(
      assignmentId,
      activeAttemptId,
      responsesForQuestions,
    );
    const { grade, feedbacksForQuestions, success } = res;
    if (!success) {
      toast.error("Failed to submit assignment.");
      return;
    }
    if (typeof grade === "number") {
      setGrade(grade * 100);
    }
    for (const feedback of feedbacksForQuestions || []) {
      setQuestion({
        id: feedback.questionId,
        questionResponses: [
          {
            id: feedback.id,
            points: feedback.totalPoints,
            feedback: feedback.feedback,
            learnerResponse: feedback.question,
            questionId: feedback.questionId,
            assignmentAttemptId: activeAttemptId,
          },
        ],
      });
    }
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
          <Title className="text-lg font-semibold">{title}</Title>
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
          disabled={editedQuestionsOnly(questions).length === 0}
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
