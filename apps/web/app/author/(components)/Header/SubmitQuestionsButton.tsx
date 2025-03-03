import TooltipMessage from "@/app/components/ToolTipMessage";
import {
  handleJumpToQuestion,
  handleJumpToQuestionTitle,
} from "@/app/Helpers/handleJumpToQuestion";
import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { Choice, QuestionVariants } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import { useRouter } from "next/navigation";
import type { FC } from "react";
import { useMemo } from "react";

interface Props {
  submitting: boolean;
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
  const hasEmptyQuestion = questions?.some(
    (question) => question.type === "EMPTY",
  );
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
  const changesSummary = useMemo(() => {
    if (!originalAssignment) return "No changes detected.";
    const diffs: string[] = [];

    // Assignment-level fields
    if (introduction !== originalAssignment.introduction)
      diffs.push("Modified introduction.");
    if (instructions !== originalAssignment.instructions)
      diffs.push("Changed instructions.");
    if (gradingCriteriaOverview !== originalAssignment.gradingCriteriaOverview)
      diffs.push("Updated grading criteria overview.");
    if (showSubmissionFeedback !== originalAssignment.showSubmissionFeedback)
      diffs.push("Changed submission feedback visibility.");
    if (showQuestionScore !== originalAssignment.showQuestionScore)
      diffs.push("Changed question score visibility.");
    if (showAssignmentScore !== originalAssignment.showAssignmentScore)
      diffs.push("Changed assignment score visibility.");

    // Questions added
    const addedQuestions = questions?.filter(
      (question) =>
        !originalAssignment.questions?.some(
          (originalQuestion) => originalQuestion.id === question.id,
        ),
    );
    if (addedQuestions?.length > 0)
      diffs.push(`${addedQuestions.length} questions added.`);

    // Questions deleted
    const deletedQuestions =
      originalAssignment.questions?.filter(
        (originalQuestion) =>
          !questions.some((question) => question.id === originalQuestion.id),
      ) || [];
    if (deletedQuestions.length > 0)
      diffs.push(`${deletedQuestions.length} questions deleted.`);

    // For each matching question, check for modifications.
    questions.forEach((question) => {
      const originalQuestion = originalAssignment.questions?.find(
        (orig) => orig.id === question.id,
      );
      if (!originalQuestion) return; // Already handled as added.

      if (question.type !== originalQuestion.type && question.type !== "EMPTY")
        diffs.push(`Changed question type for question ${question.id}.`);
      if (question.question !== originalQuestion.question)
        diffs.push(`Updated question text for question ${question.id}.`);
      if (
        JSON.stringify(question.choices) !==
        JSON.stringify(originalQuestion.choices)
      )
        diffs.push(`Modified choices for question ${question.id}.`);
      if (
        JSON.stringify(
          question.scoring?.criteria?.map((c) => ({
            description: c.description,
            points: c.points,
          })) || [],
        ) !==
        JSON.stringify(
          originalQuestion.scoring?.criteria?.map((c) => ({
            description: c.description,
            points: c.points,
          })) || [],
        )
      )
        diffs.push(`Updated scoring for question ${question.id}.`);
      if (question.randomizedChoices !== originalQuestion.randomizedChoices)
        diffs.push(`Updated randomized choices for question ${question.id}.`);
      if (question.responseType !== originalQuestion.responseType)
        diffs.push(`Changed response type for question ${question.id}.`);
      if (question.maxWords !== originalQuestion.maxWords)
        diffs.push(`Updated max words for question ${question.id}.`);
      if (question.maxCharacters !== originalQuestion.maxCharacters)
        diffs.push(`Updated max characters for question ${question.id}.`);

      // --- Variants comparison (using variantContent as key) ---
      const newVariants = question.variants || [];
      const origVariants = originalQuestion.variants || [];

      // Helper to get a simplified variant key
      const getVariantKey = (variant: QuestionVariants) =>
        variant.variantContent;

      // Added variants: in newVariants but not in origVariants (by variantContent)
      const addedVariants = newVariants.filter(
        (variant) =>
          !origVariants.some(
            (orig) => getVariantKey(orig) === getVariantKey(variant),
          ),
      );
      if (addedVariants.length > 0)
        diffs.push(
          `Added ${addedVariants.length} variant(s) for question ${question.id}.`,
        );

      // Deleted variants: in origVariants but not in newVariants
      const deletedVariants = origVariants.filter(
        (orig) =>
          !newVariants.some(
            (variant) => getVariantKey(variant) === getVariantKey(orig),
          ),
      );
      if (deletedVariants.length > 0)
        diffs.push(
          `Deleted ${deletedVariants.length} variant(s) for question ${question.id}.`,
        );

      // For variants present in both, check if other properties differ.
      newVariants.forEach((variant) => {
        const matchingOrig = origVariants.find(
          (orig) => getVariantKey(orig) === getVariantKey(variant),
        );
        if (matchingOrig) {
          if (variant.randomizedChoices !== matchingOrig.randomizedChoices)
            diffs.push(
              `Modified randomized choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          if (
            JSON.stringify(variant.choices) !==
            JSON.stringify(matchingOrig.choices)
          )
            diffs.push(
              `Modified choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
        }
      });
    });

    // Compare configuration fields
    if (questionDisplay !== originalAssignment.questionDisplay)
      diffs.push("Changed question display type.");

    // Check for overall variation changes (using the variants length as a rough check)
    questions.forEach((question) => {
      const originalQuestion = originalAssignment.questions?.find(
        (orig) => orig.id === question.id,
      );
      const newVarCount = question.variants?.length || 0;
      const origVarCount = originalQuestion?.variants?.length || 0;
      if (newVarCount < origVarCount)
        diffs.push(`Deleted question variations for question ${question.id}.`);
      if (newVarCount > origVarCount)
        diffs.push(`Added question variations for question ${question.id}.`);
    });

    if (numAttempts !== originalAssignment.numAttempts)
      diffs.push("Updated number of attempts.");
    if (passingGrade !== originalAssignment.passingGrade)
      diffs.push("Modified passing grade.");
    if (
      (timeEstimateMinutes ?? null) !==
      (originalAssignment.timeEstimateMinutes ?? null)
    )
      diffs.push("Updated time estimate.");
    if (allotedTimeMinutes !== originalAssignment.allotedTimeMinutes)
      diffs.push(`Set alloted time to ${allotedTimeMinutes} minutes.`);
    if (displayOrder !== originalAssignment.displayOrder)
      diffs.push("Modified question order.");
    if (graded !== originalAssignment.graded)
      diffs.push(graded ? "Enabled grading." : "Disabled grading.");
    console.log("diffs", diffs);
    return diffs.length > 0 ? diffs.join(" ") : "No changes detected.";
  }, [
    originalAssignment,
    questions,
    introduction,
    instructions,
    gradingCriteriaOverview,
    questionDisplay,
    questionVariationNumber,
    numAttempts,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
    displayOrder,
    strictTimeLimit,
    graded,
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
  ]);

  const hasChanges = changesSummary !== "No changes detected.";
  const handleNavigate = () => {
    if (invalidQuestionId) {
      setFocusedQuestionId(invalidQuestionId);
      setTimeout(() => {
        handleJumpToQuestionTitle(invalidQuestionId.toString());
      }, 0);
    } else if (step) {
      if (step === 1) router.push(`/author/${assignmentId}`);
      if (step === 2) router.push(`/author/${assignmentId}/config`);
      if (step === 3) router.push(`/author/${assignmentId}/questions`);
    }
  };
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
      distance={-15}
      up={0.3}
      direction="x"
    >
      <button
        type="button"
        disabled={disableButton}
        onClick={handlePublishButton}
        className="text-sm font-medium items-center justify-center px-4 py-2 border border-solid rounded-md shadow-sm focus:ring-offset-2 focus:ring-violet-600 focus:ring-2 focus:outline-none disabled:opacity-50 transition-all text-white border-violet-600 bg-violet-600 hover:bg-violet-800 hover:border-violet-800"
      >
        {submitting ? <Spinner className="w-5 h-5" /> : "Save & Publish"}
      </button>
    </Tooltip>
  );
};

export default SubmitQuestionsButton;
