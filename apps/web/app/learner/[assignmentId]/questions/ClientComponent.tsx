"use client";

import { getStoredData } from "@/app/Helpers/getStoredDataFromLocal";
import type { AssignmentDetails, QuestionStore } from "@/config/types";
import { generateTempQuestionId } from "@/lib/utils";
import { useAssignmentDetails, useLearnerStore } from "@/stores/learner";
import QuestionPage from "@learnerComponents/Question";
import { useEffect, useMemo } from "react";

interface ClientLearnerLayoutProps {
  assignmentId: number;
  role?: "learner" | "author";
}

const ClientLearnerLayout: React.FC<ClientLearnerLayoutProps> = ({
  assignmentId,
  role,
}) => {
  const setAssignmentDetails = useAssignmentDetails(
    (state) => state.setAssignmentDetails,
  );
  const setRole = useLearnerStore((state) => state.setRole);
  useEffect(() => {
    setRole(role || "learner");
  }, [role]);
  const assignmentDetails = getStoredData(
    "assignmentConfig",
    {},
  ) as AssignmentDetails;
  const allQuestions = getStoredData("questions", []) as QuestionStore[];
  const numberOfQuestionsPerAttempt =
    assignmentDetails?.numberOfQuestionsPerAttempt || null;
  const displayOrder = assignmentDetails?.displayOrder;
  // Content-based dep: `allQuestions` is a fresh array each render (re-parsed
  // from localStorage), so we key the memo on the question id list instead of
  // the array ref — otherwise the shuffle would re-run on every render.
  const questionIdsKey = allQuestions.map((q) => q.id).join("|");
  const questions: QuestionStore[] = useMemo(() => {
    const shouldShuffle =
      displayOrder === "RANDOM" ||
      (numberOfQuestionsPerAttempt !== null && numberOfQuestionsPerAttempt > 0);

    if (!shouldShuffle) return allQuestions;

    const pool = [...allQuestions];
    for (let index = pool.length - 1; index > 0; index--) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }

    return numberOfQuestionsPerAttempt && numberOfQuestionsPerAttempt > 0
      ? pool.slice(0, numberOfQuestionsPerAttempt)
      : pool;
  }, [questionIdsKey, displayOrder, numberOfQuestionsPerAttempt]);
  useEffect(() => {
    setAssignmentDetails({
      ...assignmentDetails,
      showQuestions: assignmentDetails.showQuestions || false,
      introduction: assignmentDetails.introduction || "",
      graded: assignmentDetails.graded || false,
      published: assignmentDetails.published || false,
      questionOrder: assignmentDetails.questionOrder || [],
      updatedAt:
        typeof assignmentDetails.updatedAt === "string"
          ? Date.parse(assignmentDetails.updatedAt)
          : assignmentDetails.updatedAt || Date.now(),
      passingGrade: assignmentDetails.passingGrade || 0,
      showSubmissionFeedback: assignmentDetails.showSubmissionFeedback || false,
      showQuestionScore: assignmentDetails.showQuestionScore || false,
      showAssignmentScore: assignmentDetails.showAssignmentScore || false,
      questionControls: assignmentDetails.questionControls,
    });
  }, [assignmentDetails, setAssignmentDetails]);

  return (
    <main className="flex flex-col h-[calc(100vh-100px)]">
      <QuestionPage
        attempt={{
          id: generateTempQuestionId(),
          assignmentId,
          submitted: false,
          questions,
          assignmentDetails,
          expiresAt:
            assignmentDetails?.strictTimeLimit === true
              ? new Date(
                  Date.now() +
                    (assignmentDetails?.allotedTimeMinutes || 0) * 60000,
                ).toISOString()
              : null,
        }}
        assignmentId={assignmentId}
      />
    </main>
  );
};

export default ClientLearnerLayout;
