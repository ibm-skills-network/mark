import { z } from "zod";

const identity = z.number().int().positive().safe();
const points = z.number().finite().nonnegative();
const score = z.number().finite().min(0).max(1);

export class InvalidGradingResultError extends Error {
  readonly code = "INVALID_GRADING_RESULT";
  readonly retryable = false;
  constructor() {
    super(
      "The grading result could not be verified. No new grade was saved. Please try again or contact support.",
    );
    this.name = "InvalidGradingResultError";
  }
}

// Only the legacy score/identity projection is authoritative here. Feedback
// metadata is still owned by the existing renderer, not this commit contract.
export const questionGradeSchema = z
  .object({
    questionId: identity,
    totalPoints: points,
  })
  .passthrough();
export type QuestionGrade = z.infer<typeof questionGradeSchema>;

export function assertQuestionGrade(
  input: unknown,
  questionId: number,
  maxPoints: number,
): void {
  const result = questionGradeSchema.safeParse(input);
  if (
    !result.success ||
    !points.safeParse(maxPoints).success ||
    result.data.questionId !== questionId ||
    result.data.totalPoints > maxPoints + 1e-9
  ) {
    throw new InvalidGradingResultError();
  }
}

export const gradeCommitV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    attemptId: identity,
    grade: score,
    expectedQuestionIds: z.array(identity),
    results: z.array(
      z
        .object({
          questionId: identity,
          response: questionGradeSchema,
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((commit, context) => {
    const expected = new Set(commit.expectedQuestionIds);
    const actual = new Set<number>();
    let valid =
      expected.size === commit.expectedQuestionIds.length &&
      commit.results.length === expected.size;
    for (const result of commit.results) {
      if (
        !expected.has(result.questionId) ||
        actual.has(result.questionId) ||
        result.response.questionId !== result.questionId
      )
        valid = false;
      actual.add(result.questionId);
    }
    if (!valid)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Result identities do not match submission",
      });
  });
export type GradeCommitV1 = z.infer<typeof gradeCommitV1Schema>;

export function assertGradeCommit(input: unknown): void {
  if (!gradeCommitV1Schema.safeParse(input).success)
    throw new InvalidGradingResultError();
}

export function assertCommittedGrade(
  input: unknown,
  attemptId: number,
  expectedGrade: number,
): void {
  const result = z
    .object({ id: identity, submitted: z.literal(true), grade: score })
    .safeParse(input);
  if (
    !result.success ||
    result.data.id !== attemptId ||
    result.data.grade !== expectedGrade
  ) {
    throw new InvalidGradingResultError();
  }
}
