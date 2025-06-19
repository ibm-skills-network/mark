"use client";

import TooltipMessage from "@/app/components/ToolTipMessage";
import { useChangesSummary } from "@/app/Helpers/checkDiff";
import {
  handleJumpToQuestionTitle,
} from "@/app/Helpers/handleJumpToQuestion";
import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import { useRouter } from "next/navigation";
import type { FC } from "react";

interface Props {
  submitting: boolean;
  // This function returns an object with isValid, message, step, etc.
  questionsAreReadyToBePublished: () => {
    isValid: boolean;
    message: string;
    step: number | null;
    invalidQuestionId: number;
  };
  handlePublishButton: () => void;
}

const SubmitQuestionsButton: FC<Props> = ({
  submitting,
  questionsAreReadyToBePublished,
  handlePublishButton,
}) => {
  const router = useRouter();
  const { isValid, message, step, invalidQuestionId } =
    questionsAreReadyToBePublished();
  const questions = useAuthorStore((state) => state.questions);
  const originalAssignment = useAuthorStore(
    (state) => state.originalAssignment,
  );
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId,
  );
  const isLoading = !questions;
  const hasEmptyQuestion = questions?.some((q) => q.type === "EMPTY");
  const {
    name,
    introduction,
    instructions,
    gradingCriteriaOverview,
    assignmentId,
  } = useAuthorStore((state) => ({
    name: state.name,
    introduction: state.introduction,
    instructions: state.instructions,
    gradingCriteriaOverview: state.gradingCriteriaOverview,
    assignmentId: state.activeAssignmentId,
  }));
  const {
    questionDisplay,
    questionVariationNumber,
    numAttempts,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
    displayOrder,
    strictTimeLimit,
    graded,
  } = useAssignmentConfig();
  const {
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
  } = useAssignmentFeedbackConfig();
  const changesSummary = useChangesSummary();
  const hasChanges = changesSummary !== "No changes detected.";

  function handleNavigate() {
    if (invalidQuestionId) {
      setFocusedQuestionId(invalidQuestionId);
      setTimeout(() => {
        handleJumpToQuestionTitle(invalidQuestionId.toString());
      }, 0);
    }
    if (step) {
      if (step === 1) router.push(`/author/${assignmentId}`);
      if (step === 2) router.push(`/author/${assignmentId}/config`);
      if (step === 3) router.push(`/author/${assignmentId}/questions`);
    }
  }

  const disableButton =
    submitting ||
    isLoading ||
    questions?.length === 0 ||
    hasEmptyQuestion ||
    !isValid ||
    !hasChanges;
  return (
    <Tooltip
      disabled={!disableButton}
      content={
        <TooltipMessage
          isLoading={isLoading}
          questionsLength={questions?.length}
          hasEmptyQuestion={hasEmptyQuestion}
          isValid={isValid}
          message={message}
          submitting={submitting}
          hasChanges={hasChanges}
          changesSummary={changesSummary}
          invalidQuestionId={invalidQuestionId}
          onNavigate={handleNavigate}
        />
      }
      distance={-2}
    >
      <button
        type="button"
        disabled={disableButton}
        onClick={handlePublishButton}
        className="text-sm font-medium flex items-center justify-center px-3 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
      >
        {submitting ? <Spinner className="w-5 h-5" /> : "Save & Publish"}
      </button>
    </Tooltip>
  );
};

export default SubmitQuestionsButton;
