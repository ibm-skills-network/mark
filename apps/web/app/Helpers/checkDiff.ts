import { useMemo } from "react";
import { useAuthorStore } from "@/stores/author";
import { useAssignmentConfig } from "@/stores/assignmentConfig";
import { useAssignmentFeedbackConfig } from "@/stores/assignmentFeedbackConfig";
import { Choice, QuestionVariants } from "@/config/types";

export function useChangesSummary(): string {
  // Pull in everything you need from your stores
  const originalAssignment = useAuthorStore(
    (state) => state.originalAssignment,
  );
  const questions = useAuthorStore((state) => state.questions);

  const introduction = useAuthorStore((state) => state.introduction);
  const instructions = useAuthorStore((state) => state.instructions);
  const gradingCriteriaOverview = useAuthorStore(
    (state) => state.gradingCriteriaOverview,
  );

  // Config
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

  // Feedback
  const {
    verbosityLevel,
    showSubmissionFeedback,
    showQuestionScore,
    showAssignmentScore,
  } = useAssignmentFeedbackConfig();

  const changesSummary = useMemo(() => {
    if (!originalAssignment) return "No changes detected.";
    const diffs: string[] = [];

    // -- Assignment-level fields --
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

    // -- Questions added --
    const addedQuestions = questions?.filter(
      (question) =>
        !originalAssignment.questions?.some(
          (originalQuestion) => originalQuestion.id === question.id,
        ),
    );
    if (addedQuestions?.length)
      diffs.push(`${addedQuestions.length} questions added.`);

    // -- Questions deleted --
    const deletedQuestions =
      originalAssignment.questions?.filter(
        (originalQuestion) =>
          !questions.some((question) => question.id === originalQuestion.id),
      ) || [];
    if (deletedQuestions.length)
      diffs.push(`${deletedQuestions.length} questions deleted.`);

    // -- Matching questions, check modifications --
    questions.forEach((question) => {
      const originalQuestion = originalAssignment.questions?.find(
        (orig) => orig.id === question.id,
      );
      if (!originalQuestion) return; // This question was added

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
          question.scoring?.rubrics?.map((r) => {
            return {
              rubricQuestion: r.rubricQuestion,
              criteria: r.criteria.map((c) => {
                return {
                  description: c.description,
                  points: c.points,
                };
              }),
            };
          }),
        ) !==
          JSON.stringify(
            originalQuestion.scoring?.rubrics?.map((r) => {
              return {
                rubricQuestion: r.rubricQuestion,
                criteria: r.criteria.map((c) => {
                  return {
                    description: c.description,
                    points: c.points,
                  };
                }),
              };
            }),
          ) &&
        question.scoring?.rubrics?.length > 0 &&
        originalQuestion.scoring?.rubrics?.length > 0
      ) {
        diffs.push(`Updated scoring criteria for question ${question.id}.`);
      }
      if (question.randomizedChoices !== originalQuestion.randomizedChoices)
        diffs.push(`Updated randomized choices for question ${question.id}.`);
      if (question.responseType !== originalQuestion.responseType)
        diffs.push(`Changed response type for question ${question.id}.`);
      if (question.maxWords !== originalQuestion.maxWords)
        diffs.push(`Updated max words for question ${question.id}.`);
      if (question.maxCharacters !== originalQuestion.maxCharacters)
        diffs.push(`Updated max characters for question ${question.id}.`);

      // -- Variant comparison --
      const newVariants = question.variants || [];
      const origVariants = originalQuestion.variants || [];

      const getVariantKey = (variant: QuestionVariants) =>
        variant.variantContent;
      // Added variants
      const addedVariants = newVariants.filter(
        (variant) =>
          !origVariants.some(
            (orig) => getVariantKey(orig) === getVariantKey(variant),
          ),
      );
      if (addedVariants.length)
        diffs.push(
          `Added ${addedVariants.length} variant(s) for question ${question.id}.`,
        );

      // Deleted variants
      const deletedVariants = origVariants.filter(
        (orig) =>
          !newVariants.some(
            (variant) => getVariantKey(variant) === getVariantKey(orig),
          ),
      );
      if (deletedVariants.length)
        diffs.push(
          `Deleted ${deletedVariants.length} variant(s) for question ${question.id}.`,
        );

      // For variants present in both
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
          if (
            JSON.stringify(variant.scoring) !==
            JSON.stringify(matchingOrig.scoring)
          )
            diffs.push(
              `Modified scoring for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          if (variant.maxWords !== matchingOrig.maxWords)
            diffs.push(
              `Updated max words for variant "${variant.variantContent}" in question ${question.id}.`,
            );
          if (variant.maxCharacters !== matchingOrig.maxCharacters)
            diffs.push(
              `Updated max characters for variant "${variant.variantContent}" in question ${question.id}.`,
            );
        }
      });
    });

    // -- Configuration fields --
    if (questionDisplay !== originalAssignment.questionDisplay)
      diffs.push("Changed question display type.");

    // Variation changes (using the variants length as a rough check)
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
    if (
      allotedTimeMinutes !== originalAssignment.allotedTimeMinutes &&
      allotedTimeMinutes
    )
      diffs.push(`Set alloted time to ${allotedTimeMinutes} minutes.`);
    if (displayOrder !== originalAssignment.displayOrder)
      diffs.push("Modified question order.");
    if (graded !== originalAssignment.graded)
      diffs.push(graded ? "Enabled grading." : "Disabled grading.");
    if (diffs) console.log("diffs", diffs);
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

  return changesSummary;
}
