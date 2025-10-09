import { Choice, QuestionVariants } from "@/config/types";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { useAuthorStore } from "@/stores/author";
import { useMemo } from "react";

function safeCompare<T>(
  a: T | null | undefined,
  b: T | null | undefined,
): boolean {
  if (a == null && b == null) return true;

  if (a == null || b == null) return false;

  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  return a === b;
}

function safeArrayCompare<T>(
  a: T[] | null | undefined,
  b: T[] | null | undefined,
  compareFn?: (itemA: T, itemB: T) => boolean,
): boolean {
  // Normalize null/undefined to empty arrays for comparison
  const normalizeArray = (arr: T[] | null | undefined): T[] => {
    if (arr == null) return [];
    return arr;
  };

  const normalizedA = normalizeArray(a);
  const normalizedB = normalizeArray(b);

  if (normalizedA.length !== normalizedB.length) return false;

  if (normalizedA.length === 0 && normalizedB.length === 0) return true;

  if (compareFn) {
    for (let i = 0; i < normalizedA.length; i++) {
      const matchFound = normalizedB.some((bItem) =>
        compareFn(normalizedA[i], bItem),
      );
      if (!matchFound) return false;
    }
    return true;
  }

  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

export function useChangesSummary(): string {
  const originalAssignment = useAuthorStore(
    (state) => state.originalAssignment,
  );
  const questions = useAuthorStore((state) => state.questions);
  const introduction = useAuthorStore((state) => state.introduction);
  const instructions = useAuthorStore((state) => state.instructions);
  const gradingCriteriaOverview = useAuthorStore(
    (state) => state.gradingCriteriaOverview,
  );
  const questionOrder = useAuthorStore((state) => state.questionOrder);

  const {
    questionDisplay,
    questionVariationNumber,
    numAttempts,
    attemptsBeforeCoolDown,
    retakeAttemptCoolDownMinutes,
    passingGrade,
    timeEstimateMinutes,
    allotedTimeMinutes,
    displayOrder,
    strictTimeLimit,
    graded,
    numberOfQuestionsPerAttempt,
  } = useAssignmentConfig();

  const {
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
    showQuestions,
    correctAnswerVisibility,
  } = useAssignmentFeedbackConfig();

  const changesSummary = useMemo(() => {
    if (!originalAssignment) return "No changes detected.";

    const diffs: string[] = [];

    if (!safeCompare(introduction, originalAssignment.introduction))
      diffs.push("Modified introduction.");

    if (!safeCompare(instructions, originalAssignment.instructions))
      diffs.push("Changed instructions.");
    if (!safeCompare(showQuestions, originalAssignment.showQuestions))
      diffs.push("Changed question visibility.");

    if (
      !safeCompare(
        gradingCriteriaOverview,
        originalAssignment.gradingCriteriaOverview,
      )
    )
      diffs.push("Updated grading criteria overview.");

    if (
      !safeCompare(
        showSubmissionFeedback,
        originalAssignment.showSubmissionFeedback,
      )
    )
      diffs.push("Changed submission feedback visibility.");

    if (!safeCompare(showQuestionScore, originalAssignment.showQuestionScore))
      diffs.push("Changed question score visibility.");

    if (
      !safeCompare(showAssignmentScore, originalAssignment.showAssignmentScore)
    )
      diffs.push("Changed assignment score visibility.");

    if (
      !safeCompare(
        correctAnswerVisibility,
        originalAssignment.correctAnswerVisibility ?? "ALWAYS",
      )
    )
      diffs.push("Changed correct answer visibility.");

    // check if question order is different
    if (!safeArrayCompare(questionOrder, originalAssignment.questionOrder)) {
      diffs.push("Modified question order.");
    }

    const originalQuestions = originalAssignment.questions || [];
    const currentQuestions = questions instanceof Array ? questions : [];

    const addedQuestions = currentQuestions?.filter(
      (question) =>
        !originalQuestions.some((origQ) => origQ.id === question?.id),
    );

    if (addedQuestions.length > 0) {
      diffs.push(`${addedQuestions.length} questions added.`);
    }

    const deletedQuestions = originalQuestions.filter(
      (origQ) => !currentQuestions.some((q) => q?.id === origQ.id),
    );

    if (deletedQuestions.length > 0) {
      diffs.push(`${deletedQuestions.length} questions deleted.`);
    }

    currentQuestions.forEach((question) => {
      if (!question) return;

      const originalQuestion = originalQuestions.find(
        (orig) => orig?.id === question.id,
      );

      if (!originalQuestion) return;

      if (
        !safeCompare(question.type, originalQuestion.type) &&
        question.type !== "EMPTY"
      ) {
        diffs.push(`Changed question type for question ${question.id}.`);
      }

      if (!safeCompare(question.question, originalQuestion.question)) {
        diffs.push(`Updated question text for question ${question.id}.`);
      }

      if (!safeArrayCompare(question.choices, originalQuestion.choices)) {
        diffs.push(`Modified choices for question ${question.id}.`);
      }

      const compareRubrics = () => {
        const currentRubrics = question.scoring?.rubrics || [];
        const originalRubrics = originalQuestion.scoring?.rubrics || [];

        if (currentRubrics.length === 0 && originalRubrics.length === 0)
          return true;

        return currentRubrics.every((currentRubric, index) => {
          const origRubric = originalRubrics[index];

          if (
            !safeCompare(
              currentRubric?.rubricQuestion,
              origRubric?.rubricQuestion,
            )
          ) {
            return false;
          }

          const currentCriteria = currentRubric.criteria || [];
          const origCriteria = origRubric.criteria || [];

          if (currentCriteria.length !== origCriteria.length) return false;

          return currentCriteria.every((currentCrit, critIndex) => {
            const origCrit = origCriteria[critIndex];
            return (
              safeCompare(currentCrit.description, origCrit.description) &&
              safeCompare(currentCrit.points, origCrit.points)
            );
          });
        });
      };

      if (
        (question.scoring?.rubrics || []).length > 0 ||
        (originalQuestion.scoring?.rubrics || []).length > 0
      ) {
        if (!compareRubrics()) {
          diffs.push(`Updated scoring criteria for question ${question.id}.`);
        }
      }

      if (
        !safeCompare(
          question.scoring?.showRubricsToLearner,
          originalQuestion.scoring?.showRubricsToLearner,
        )
      ) {
        diffs.push(
          `Changed "show rubric to learner" setting for question ${question.id}.`,
        );
      }

      if (
        !safeCompare(
          question.scoring?.showPoints,
          originalQuestion.scoring?.showPoints,
        )
      ) {
        diffs.push(
          `Changed "show points to learner" setting for question ${question.id}.`,
        );
      }

      // Compare randomized choices
      if (
        !safeCompare(
          question.randomizedChoices,
          originalQuestion.randomizedChoices,
        )
      ) {
        diffs.push(`Updated randomized choices for question ${question.id}.`);
      }

      if (!safeCompare(question.responseType, originalQuestion.responseType)) {
        diffs.push(`Changed response type for question ${question.id}.`);
      }

      if (!safeCompare(question.maxWords, originalQuestion.maxWords)) {
        diffs.push(`Updated max words for question ${question.id}.`);
      }

      if (
        !safeCompare(question.maxCharacters, originalQuestion.maxCharacters)
      ) {
        diffs.push(`Updated max characters for question ${question.id}.`);
      }

      if (
        !safeCompare(
          question.videoPresentationConfig,
          originalQuestion.videoPresentationConfig,
        ) &&
        (question.videoPresentationConfig ||
          originalQuestion.videoPresentationConfig)
      ) {
        diffs.push(
          `Updated video presentation config for question ${question.id}.`,
        );
      }

      if (
        !safeCompare(
          question.liveRecordingConfig,
          originalQuestion.liveRecordingConfig,
        ) &&
        (question.liveRecordingConfig || originalQuestion.liveRecordingConfig)
      ) {
        diffs.push(
          `Updated live recording config for question ${question.id}.`,
        );
      }

      const newVariants = question.variants || [];
      const origVariants = originalQuestion.variants || [];

      const getVariantKey = (variant: QuestionVariants) =>
        variant.variantContent;

      const addedVariants = newVariants.filter(
        (variant) =>
          !origVariants.some(
            (orig) => getVariantKey(orig) === getVariantKey(variant),
          ),
      );

      if (addedVariants.length > 0) {
        diffs.push(
          `Added ${addedVariants.length} variant(s) for question ${question.id}.`,
        );
      }

      const deletedVariants = origVariants.filter(
        (orig) =>
          !newVariants.some(
            (variant) => getVariantKey(variant) === getVariantKey(orig),
          ),
      );

      if (deletedVariants.length > 0) {
        diffs.push(
          `Deleted ${deletedVariants.length} variant(s) for question ${question.id}.`,
        );
      }

      newVariants.forEach((variant) => {
        if (!variant) return;

        const matchingOrig = origVariants.find(
          (orig) => orig && getVariantKey(orig) === getVariantKey(variant),
        );

        if (matchingOrig) {
          if (
            !safeCompare(
              variant.randomizedChoices,
              matchingOrig.randomizedChoices,
            )
          ) {
            diffs.push(
              `Modified randomized choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }
          if (
            !safeArrayCompare(
              variant.choices as Choice[],
              matchingOrig.choices as Choice[],
            )
          ) {
            diffs.push(
              `Modified choices for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          if (!safeCompare(variant.scoring, matchingOrig.scoring)) {
            diffs.push(
              `Modified scoring for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          if (!safeCompare(variant.maxWords, matchingOrig.maxWords)) {
            diffs.push(
              `Updated max words for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }

          if (!safeCompare(variant.maxCharacters, matchingOrig.maxCharacters)) {
            diffs.push(
              `Updated max characters for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          }
        }
      });
    });

    if (!safeCompare(questionDisplay, originalAssignment.questionDisplay)) {
      diffs.push("Changed question display type.");
    }

    if (
      !safeCompare(
        numberOfQuestionsPerAttempt,
        originalAssignment.numberOfQuestionsPerAttempt,
      )
    ) {
      diffs.push("Updated number of questions per attempt.");
    }

    if (!safeCompare(numAttempts, originalAssignment.numAttempts)) {
      diffs.push("Updated number of attempts.");
    }

    if (
      !safeCompare(
        attemptsBeforeCoolDown,
        originalAssignment.attemptsBeforeCoolDown,
      )
    ) {
      diffs.push("Updated number of attempts before cooldown period.");
    }

    if (
      !safeCompare(
        retakeAttemptCoolDownMinutes,
        originalAssignment.retakeAttemptCoolDownMinutes,
      )
    ) {
      diffs.push("Updated the cooldown time before retries allowed.");
    }

    if (!safeCompare(passingGrade, originalAssignment.passingGrade)) {
      diffs.push("Modified passing grade.");
    }

    if (
      !safeCompare(timeEstimateMinutes, originalAssignment.timeEstimateMinutes)
    ) {
      diffs.push("Updated time estimate.");
    }

    if (
      !safeCompare(allotedTimeMinutes, originalAssignment.allotedTimeMinutes) &&
      allotedTimeMinutes
    ) {
      diffs.push(`Set alloted time to ${allotedTimeMinutes} minutes.`);
    }

    if (!safeCompare(displayOrder, originalAssignment.displayOrder)) {
      diffs.push("Modified question order.");
    }

    if (!safeCompare(graded, originalAssignment.graded)) {
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
    attemptsBeforeCoolDown,
    retakeAttemptCoolDownMinutes,
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
    showQuestions,
    numberOfQuestionsPerAttempt,
  ]);
  return changesSummary;
}
