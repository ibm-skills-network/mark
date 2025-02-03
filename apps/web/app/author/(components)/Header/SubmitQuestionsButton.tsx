import { handleJumpToQuestion } from "@/app/Helpers/handleJumpToQuestion";
import Spinner from "@/components/svgs/Spinner";
import Tooltip from "@/components/Tooltip";
import { Choice } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import type { FC } from "react";
import { useMemo } from "react";

interface Props {
  submitting: boolean;
  questionsAreReadyToBePublished: () => {
    isValid: boolean;
    message: string;
    invalidQuestionId: number;
  };
  handlePublishButton: () => void;
}

const SubmitQuestionsButton: FC<Props> = ({
  submitting,
  questionsAreReadyToBePublished,
  handlePublishButton,
}) => {
  const { isValid, message, invalidQuestionId } =
    questionsAreReadyToBePublished();
  const questions = useAuthorStore((state) => state.questions);
  const originalAssignment = useAuthorStore(
    (state) => state.originalAssignment
  );
  const setFocusedQuestionId = useAuthorStore(
    (state) => state.setFocusedQuestionId
  );
  const isLoading = !questions;
  const hasEmptyQuestion = questions?.some(
    (question) => question.type === "EMPTY"
  );
  const { name, introduction, instructions, gradingCriteriaOverview } =
    useAuthorStore((state) => ({
      name: state.name,
      introduction: state.introduction,
      instructions: state.instructions,
      gradingCriteriaOverview: state.gradingCriteriaOverview,
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

    // Compare questions
    // check for added questions
    const addedQuestions = questions.filter(
      (question) =>
        !originalAssignment?.questions?.some(
          (originalQuestion) => originalQuestion.id === question.id
        )
    );
    if (addedQuestions?.length > 0)
      diffs.push(`${addedQuestions?.length} questions added.`);
    // check for deleted questions
    const deletedQuestions = originalAssignment?.questions?.filter(
      (originalQuestion) =>
        !questions.some((question) => question.id === originalQuestion.id)
    );
    if (deletedQuestions?.length > 0)
      diffs.push(`${deletedQuestions.length} questions deleted.`);
    // check for modified questions
    const modifiedQuestions = questions?.filter((question) =>
      originalAssignment?.questions?.some(
        (originalQuestion) => originalQuestion.id === question.id
      )
    );
    modifiedQuestions.forEach((question) => {
      const originalQuestion = originalAssignment?.questions?.find(
        (originalQuestion) => originalQuestion.id === question.id
      );
      if (question.type !== originalQuestion.type && question.type !== "EMPTY")
        diffs.push(`Changed question type for question ${question.id}.`);
      if (question.question !== originalQuestion.question && question.id)
        diffs.push(`Updated question text for question ${question.id}.`);
      if (
        JSON.stringify(question.choices) !==
          JSON.stringify(originalQuestion.choices) &&
        question.choices
      )
        diffs.push(`Modified choices for question ${question.id}.`);
      if (
        JSON.stringify(
          question.scoring?.criteria?.map((criteria) => ({
            description: criteria.description,
            points: criteria.points,
          })) || []
        ) !==
          JSON.stringify(
            originalQuestion.scoring?.criteria?.map((criteria) => ({
              description: criteria.description,
              points: criteria.points,
            })) || []
          ) &&
        question.scoring
      )
        diffs.push(`Updated scoring for question ${question.id}.`);
      if (
        question.randomizedChoices !== originalQuestion.randomizedChoices &&
        question.randomizedChoices !== null
      )
        diffs.push(`Updated randomized choices for question ${question.id}.`);
      if (question.responseType !== originalQuestion.responseType)
        diffs.push(`Changed response type for question ${question.id}.`);
      if (question.maxWords !== originalQuestion.maxWords)
        diffs.push(`Updated max words for question ${question.id}.`);
      if (question.maxCharacters !== originalQuestion.maxCharacters)
        diffs.push(`Updated max characters for question ${question.id}.`);
      // check modified variants
      if (
        question.variants?.length &&
        originalQuestion.variants?.length &&
        question.variants.some(
          (variant) =>
            !originalQuestion.variants.find(
              (originalVariant) => originalVariant.id === variant.id
            )
        )
      )
        diffs.push(`Added variants for question ${question.id}.`);
      if (
        question.variants?.length &&
        originalQuestion.variants?.length &&
        originalQuestion.variants.some(
          (originalVariant) =>
            !question.variants.find(
              (variant) => variant.id === originalVariant.id
            )
        )
      )
        diffs.push(`Deleted variants for question ${question.id}.`);

      if (
        question.variants?.length &&
        originalQuestion.variants?.length &&
        question.variants.some((variant) => {
          // check if variant.randomizedChoices is modified
          const originalVariant = originalQuestion.variants.find(
            (originalVariant) => originalVariant.id === variant.id
          );
          return (
            variant.randomizedChoices !== originalVariant?.randomizedChoices
          );
        })
      )
        diffs.push(`Modified randomized choices for question ${question.id}.`);

      if (
        question.variants?.length &&
        originalQuestion.variants?.length &&
        question.variants.some((variant) => {
          const originalVariant = originalQuestion.variants.find(
            (originalVariant) => originalVariant.id === variant.id
          );
          return (
            variant.variantContent !== originalVariant?.variantContent ||
            (Array.isArray(variant.choices) &&
              variant.choices.some(
                (choice: Choice) =>
                  !(
                    Array.isArray(originalVariant.choices) &&
                    originalVariant.choices.find(
                      (originalChoice: Choice) =>
                        originalChoice.choice === choice.choice
                    )
                  ) ||
                  !(
                    Array.isArray(originalVariant.choices) &&
                    originalVariant.choices.find(
                      (originalChoice: Choice) =>
                        originalChoice.points === choice.points
                    )
                  )
              ))
          );
        })
      )
        diffs.push(`Modified variants for question ${question.id}.`);
    });

    // Compare config fields
    if (questionDisplay !== originalAssignment.questionDisplay)
      diffs.push("Changed question display type.");
    // if variations inside questions are deleted, push it to diff
    if (
      questions.some(
        (question) =>
          question?.variants?.length <
          originalAssignment?.questions?.find(
            (originalQuestion) => originalQuestion.id === question.id
          )?.variants?.length
      )
    ) {
      diffs.push("Deleted question variations.");
    }
    // added variations
    if (
      questions.some(
        (question) =>
          question?.variants?.length >
          originalAssignment?.questions?.find(
            (originalQuestion) => originalQuestion.id === question.id
          )?.variants?.length
      )
    ) {
      diffs.push("Added question variations.");
    }
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
    if (graded !== originalAssignment.graded) {
      diffs.push(graded ? "Enabled grading." : "Disabled grading.");
    }
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

  const disableButton =
    submitting ||
    isLoading ||
    questions?.length === 0 ||
    hasEmptyQuestion ||
    !isValid ||
    !hasChanges;

  const tooltipMessage = useMemo(() => {
    if (isLoading) return "Loading questions...";
    if (questions?.length === 0) return "You need to add at least one question";
    if (hasEmptyQuestion) return "Some questions have incomplete fields";
    if (!isValid)
      return (
        <>
          <span>{message}</span>
          <button
            onClick={() => {
              setFocusedQuestionId(invalidQuestionId);
              handleJumpToQuestion(`indexQuestion-${invalidQuestionId}`);
            }}
            className="ml-2 text-blue-500 hover:underline"
          >
            Take me there
          </button>
        </>
      );
    if (submitting) return "Mark is analyzing your questions...";
    if (!hasChanges) return "No changes detected.";

    // Render changes summary if there are changes
    return (
      <>
        <span>Click to save and publish your changes.</span>
        <span className="block mt-2 text-sm font-normal text-gray-500">
          {changesSummary}
        </span>
      </>
    );
  }, [
    isLoading,
    questions?.length,
    hasEmptyQuestion,
    isValid,
    message,
    submitting,
    changesSummary,
    hasChanges,
    invalidQuestionId,
    setFocusedQuestionId,
  ]);

  return (
    <Tooltip
      disabled={!disableButton}
      content={tooltipMessage}
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
