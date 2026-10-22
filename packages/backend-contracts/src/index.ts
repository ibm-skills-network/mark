import { z } from "zod";

const positiveId = z.number().int().positive().safe();
const finiteNumber = z.number().finite();

// Compatibility schemas validate transport shape, not source ownership or
// evidence sufficiency. Legacy file text and metadata remain untrusted inputs.
const legacyFile = z
  .object({
    filename: z.string(),
    content: z
      .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
      .nullish(),
    key: z.string().nullish(),
    bucket: z.string().nullish(),
    mimeType: z.string().nullish(),
  })
  .passthrough();

const legacyPresentation = z
  .object({
    transcript: z.string().nullish(),
    slidesData: z
      .array(
        z
          .object({
            slideNumber: finiteNumber,
            slideText: z.string(),
            slideImage: z.string(),
          })
          .passthrough(),
      )
      .nullish(),
    speechReport: z.string().nullish(),
    contentReport: z.string().nullish(),
    bodyLanguageScore: finiteNumber.nullish(),
    bodyLanguageExplanation: z.string().nullish(),
  })
  .passthrough();

export const legacyAnswerSchema = z
  .object({
    id: positiveId,
    question: z.string().nullish(),
    learnerTextResponse: z.string().nullish(),
    learnerUrlResponse: z.string().max(2048).nullish(),
    learnerChoices: z.array(z.union([z.string(), finiteNumber])).nullish(),
    learnerAnswerChoice: z.boolean().nullish(),
    learnerFileResponse: z.array(legacyFile).nullish(),
    learnerPresentationResponse: legacyPresentation.nullish(),
  })
  .passthrough();

export const legacySubmissionSchema = z
  .object({
    submitted: z.literal(true),
    responsesForQuestions: z
      .array(legacyAnswerSchema)
      .superRefine((answers, context) => {
        const seen = new Set<number>();
        answers.forEach((answer, index) => {
          if (seen.has(answer.id)) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "id"],
              message: "Duplicate question identity",
            });
          }
          seen.add(answer.id);
        });
      }),
    language: z.string().nullish(),
  })
  .passthrough();

const workerIdentity = z
  .object({
    userId: z.string().min(1),
    role: z.literal("learner"),
    gradingCallbackRequired: z.boolean().optional(),
  })
  .passthrough();

const gradingFields = {
  gradingJobId: z.string().min(1).max(256),
  attemptId: positiveId,
  assignmentId: positiveId,
  updateDto: legacySubmissionSchema,
  authCookie: z.string().optional(),
  userSession: workerIdentity,
};

// Version 1 names the existing grading message. It does not claim that its
// mutable legacy answers are an immutable submission or durable dispatch intent.
export const gradingJobV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    ...gradingFields,
  })
  .strict();
const legacyGradingJobSchema = z.object(gradingFields).passthrough();

export type LegacySubmission = z.infer<typeof legacySubmissionSchema>;
export type GradingJobV1 = z.infer<typeof gradingJobV1Schema>;

export class GradingContractError extends Error {
  readonly code = "INVALID_GRADING_CONTRACT";
  readonly retryable = false;
  constructor(readonly boundary: "submission" | "grading-job") {
    // Never include Zod input/values: payloads can contain answers and cookies.
    super(`Invalid ${boundary} payload. No new grade was saved.`);
    this.name = "GradingContractError";
  }
}

export function parseLegacySubmission(input: unknown): LegacySubmission {
  const result = legacySubmissionSchema.safeParse(input);
  if (!result.success) throw new GradingContractError("submission");
  return result.data;
}

export function parseGradingJob(input: unknown): GradingJobV1 {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new GradingContractError("grading-job");
  }
  if (Object.prototype.hasOwnProperty.call(input, "schemaVersion")) {
    const result = gradingJobV1Schema.safeParse(input);
    if (!result.success) throw new GradingContractError("grading-job");
    return result.data;
  }
  const legacy = legacyGradingJobSchema.safeParse(input);
  if (!legacy.success) throw new GradingContractError("grading-job");
  // Only the explicit pre-versioned layout is adapted; unknown versions never
  // fall back to legacy. Preserve legacy answer metadata without coercion.
  return gradingJobV1Schema.parse({
    schemaVersion: 1,
    gradingJobId: legacy.data.gradingJobId,
    attemptId: legacy.data.attemptId,
    assignmentId: legacy.data.assignmentId,
    updateDto: legacy.data.updateDto,
    userSession: legacy.data.userSession,
    ...(legacy.data.authCookie !== undefined
      ? { authCookie: legacy.data.authCookie }
      : {}),
  });
}

export {
  InvalidGradingResultError,
  questionGradeSchema,
  gradeCommitV1Schema,
  assertQuestionGrade,
  assertGradeCommit,
  assertCommittedGrade,
} from "./grading-result";
export type { QuestionGrade, GradeCommitV1 } from "./grading-result";

export * from "./attempt";

export * from "./artifact";
export * from "./capabilities";
