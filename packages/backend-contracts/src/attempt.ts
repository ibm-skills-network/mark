import { z } from "zod";

const id = z.number().int().positive().safe();
const operationId = z.string().uuid();
export const pinnedChoiceSchema = z
  .object({
    id: z.string().uuid(),
    choice: z.string(),
    isCorrect: z.boolean(),
    points: z.number().finite(),
    feedback: z.string().nullish(),
  })
  .strict();
export const pinnedQuestionSchema = z
  .object({
    id,
    versionId: id.nullable(),
    variantId: id.nullable(),
    question: z.string(),
    type: z.string(),
    totalPoints: z.number().finite().nonnegative(),
    choices: z.array(pinnedChoiceSchema),
    // The published adapter retains all rubric/config fields, including false and zero.
    configuration: z.record(z.unknown()),
  })
  .strict();
export const attemptDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    assignmentVersionId: id.nullable(),
    assignment: z.record(z.unknown()),
    questions: z.array(pinnedQuestionSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.questions.map((q) => q.id)).size !== value.questions.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate question identity",
      });
    const choices = value.questions.flatMap((q) => q.choices.map((c) => c.id));
    if (new Set(choices).size !== choices.length)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate choice identity",
      });
  });
export type AttemptDefinitionV1 = z.infer<typeof attemptDefinitionSchema>;
export const draftAnswerSchema = z
  .object({
    questionId: id,
    choiceIds: z.array(z.string().uuid()).optional(),
    // Compatibility labels are mapped exactly against the snapshot, never heuristically.
    choiceLabels: z
      .array(z.union([z.string(), z.number().finite()]))
      .optional(),
    text: z.string().optional(),
    boolean: z.boolean().optional(),
    number: z.number().finite().optional(),
    sourceIds: z.array(z.string().uuid()).optional(),
  })
  .strict();
export type DraftAnswer = z.infer<typeof draftAnswerSchema>;
export const saveDraftSchema = z
  .object({
    operationId,
    expectedRevision: z.number().int().nonnegative().safe(),
    answers: z.array(draftAnswerSchema),
  })
  .strict();
export const submitDraftSchema = z
  .object({
    operationId,
    expectedRevision: z.number().int().nonnegative().safe(),
  })
  .strict();

/** Strict, pinned-only compatibility adapter. No unquoting, translation or numeric rewrite. */
export function normalizeDraftAnswers(
  definition: AttemptDefinitionV1,
  input: DraftAnswer[],
): DraftAnswer[] {
  const seen = new Set<number>();
  return input.map((answer) => {
    const question = definition.questions.find(
      (q) => q.id === answer.questionId,
    );
    if (!question || seen.has(answer.questionId))
      throw new Error("Unknown or repeated question");
    seen.add(answer.questionId);
    if (answer.choiceIds !== undefined && answer.choiceLabels !== undefined)
      throw new Error("Choose one choice identity format");
    const choiceIds =
      answer.choiceLabels?.map((label) => {
        const matches = question.choices.filter(
          (choice) => choice.choice === String(label),
        );
        if (matches.length !== 1)
          throw new Error(
            "Ambiguous or unknown choice label; reload choice IDs",
          );
        return matches[0]!.id;
      }) ?? answer.choiceIds;
    if (choiceIds !== undefined) {
      if (!["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(question.type))
        throw new Error("Choices are not allowed for this question");
      if (
        new Set(choiceIds).size !== choiceIds.length ||
        choiceIds.some((c) => !question.choices.some((p) => p.id === c))
      )
        throw new Error("Unknown or repeated choice ID");
      if (question.type === "SINGLE_CORRECT" && choiceIds.length > 1)
        throw new Error("Only one choice is allowed");
    }
    if (
      ["SINGLE_CORRECT", "MULTIPLE_CORRECT"].includes(question.type) &&
      [answer.text, answer.boolean, answer.number, answer.sourceIds].some(
        (v) => v !== undefined,
      )
    )
      throw new Error("Only choices are allowed for this question");
    if (
      answer.sourceIds &&
      new Set(answer.sourceIds).size !== answer.sourceIds.length
    )
      throw new Error("Repeated source");
    const { choiceLabels: _labels, ...normalized } = answer;
    return choiceIds === undefined ? normalized : { ...normalized, choiceIds };
  });
}

/** Learner projection uses an allowlist: rubric secrets and correct answers never leave the server. */
export function learnerDefinition(definition: AttemptDefinitionV1) {
  return {
    schemaVersion: definition.schemaVersion,
    assignmentVersionId: definition.assignmentVersionId,
    assignment: {
      name: definition.assignment.name,
      introduction: definition.assignment.introduction,
      instructions: definition.assignment.instructions,
    },
    questions: definition.questions.map((q) => ({
      id: q.id,
      versionId: q.versionId,
      variantId: q.variantId,
      question: q.question,
      type: q.type,
      totalPoints: q.totalPoints,
      choices: q.choices.map((c) => ({ id: c.id, choice: c.choice })),
    })),
  };
}

/** ID-only deterministic scorer. Text compatibility belongs exclusively to draft ingestion. */
export function gradePinnedChoice(
  question: AttemptDefinitionV1["questions"][number],
  choiceIds: string[],
) {
  const selected = question.choices.filter((c) => choiceIds.includes(c.id));
  if (
    selected.length !== choiceIds.length ||
    new Set(choiceIds).size !== choiceIds.length
  )
    throw new Error("Invalid pinned choice identity");
  if (question.type === "SINGLE_CORRECT" && selected.length > 1)
    throw new Error("Only one choice is allowed");
  const scoring = question.configuration.scoring as
    | { type?: string }
    | undefined;
  const raw = selected.reduce(
    (sum, c) =>
      sum +
      (c.isCorrect
        ? c.points
        : question.type === "MULTIPLE_CORRECT" &&
            scoring?.type === "LOSS_PER_MISTAKE"
          ? -c.points
          : 0),
    0,
  );
  return {
    questionId: question.id,
    question: question.question,
    totalPoints: Math.max(0, Math.min(raw, question.totalPoints)),
    feedback: selected.map((c) => ({
      choice: c.choice,
      feedback:
        c.feedback ??
        (c.isCorrect ? "Correct selection." : "Incorrect selection."),
    })),
    metadata: { maxPossiblePoints: question.totalPoints, choiceIds },
  };
}
