import { z } from "zod";

/**
 * The author operations Mark chat can ask the browser to run. The API builds
 * the model's tools from these (description and input schema); the web client
 * dispatches them by the same names and parameter types. Add or change an
 * operation here and both sides follow, or fail to compile.
 */
export const AUTHOR_OPERATIONS = {
  createQuestion: {
    description:
      "Generate exactly one AI question for the assignment from the provided prompt and question type",
    input: z.object({
      questionType: z
        .enum([
          "TEXT",
          "SINGLE_CORRECT",
          "MULTIPLE_CORRECT",
          "TRUE_FALSE",
          "URL",
          "UPLOAD",
        ])
        .describe("The type of question to generate"),
      questionText: z
        .string()
        .describe("Prompt/objective for generating one question"),
    }),
  },
  modifyQuestion: {
    description: "Modify an existing question",
    input: z.object({
      questionId: z.number().describe("The ID of the question to modify"),
      questionText: z
        .string()
        .optional()
        .describe("The updated text of the question"),
      totalPoints: z
        .number()
        .optional()
        .describe("The updated number of points"),
      questionType: z
        .string()
        .optional()
        .describe("The updated type of the question"),
      feedback: z.string().optional().describe("Feedback for the question"),
    }),
  },
  setQuestionChoices: {
    description: "Set the choices for a multiple choice question",
    input: z.object({
      questionId: z.number().describe("The ID of the question"),
      choices: z
        .array(
          z.object({
            text: z.string().describe("The text of the choice"),
            isCorrect: z.boolean().describe("Whether this choice is correct"),
            points: z.number().optional().describe("Points for this choice"),
            feedback: z
              .string()
              .optional()
              .describe("Feedback for this choice"),
          }),
        )
        .describe("The choices for the question"),
      variantId: z
        .number()
        .optional()
        .describe("The ID of the variant if applicable"),
    }),
  },
  addRubric: {
    description:
      "Add a scoring rubric to a question (REQUIRED for text response questions)",
    input: z.object({
      questionId: z.number().describe("The ID of the question"),
      rubricQuestion: z.string().describe("The text of the rubric question"),
      criteria: z
        .array(
          z.object({
            description: z.string().describe("Description of the criterion"),
            points: z.number().describe("Points for this criterion"),
          }),
        )
        .describe("The criteria for the rubric"),
    }),
  },
  generateQuestionVariant: {
    description: "Generate a variant of an existing question",
    input: z.object({
      questionId: z
        .number()
        .describe("The ID of the question to create a variant for"),
      variantType: z
        .enum(["REWORDED", "REPHRASED"])
        .describe("The type of variant to create"),
    }),
  },
  deleteQuestion: {
    description: "Delete a question from the assignment",
    input: z.object({
      questionId: z.number().describe("The ID of the question to delete"),
    }),
  },
  generateQuestionsFromObjectives: {
    description: "Generate questions based on learning objectives",
    input: z.object({
      learningObjectives: z
        .string()
        .describe("The learning objectives to generate questions from"),
      questionTypes: z
        .array(z.string())
        .optional()
        .describe("The types of questions to generate"),
      count: z
        .number()
        .optional()
        .describe(
          "The number of regular non-subtype questions to generate across questionTypes",
        ),
      multipleChoiceSubtypes: z
        .object({
          short: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Number of short multiple-choice questions"),
          quantitative: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Number of quantitative multiple-choice questions"),
          long: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Number of long multiple-choice questions"),
          scenario: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("Number of scenario multiple-choice questions"),
        })
        .refine(
          (value) =>
            Object.values(value).some(
              (subtypeCount) =>
                typeof subtypeCount === "number" && subtypeCount > 0,
            ),
          {
            message:
              "At least one multiple-choice subtype count must be greater than 0",
          },
        )
        .optional()
        .describe(
          "Optional Mark-owned multiple-choice subtype counts. Use these when the author asks for short, quantitative, long, or scenario multiple-choice questions.",
        ),
    }),
  },
  updateLearningObjectives: {
    description: "Update the learning objectives for the assignment",
    input: z.object({
      learningObjectives: z
        .string()
        .describe("The updated learning objectives"),
    }),
  },
  setQuestionTitle: {
    description: "Set the title for a question",
    input: z.object({
      questionId: z.number().describe("The ID of the question"),
      title: z.string().describe("The title of the question"),
    }),
  },
} as const;

export type AuthorOperationName = keyof typeof AUTHOR_OPERATIONS;

export type AuthorOperationParams<Name extends AuthorOperationName> = z.infer<
  (typeof AUTHOR_OPERATIONS)[Name]["input"]
>;

/**
 * Opens the pre-filled report/feedback/suggestion/inquiry form. The API
 * builds its params itself, so it is not a model tool.
 */
export const REPORT_PREVIEW_OPERATION = "showReportPreview";

/** One operation the API hands the browser to run. */
export type ClientOperation =
  | {
      [Name in AuthorOperationName]: {
        function: Name;
        params: AuthorOperationParams<Name>;
      };
    }[AuthorOperationName]
  | {
      function: typeof REPORT_PREVIEW_OPERATION;
      params: Record<string, unknown>;
    };

/**
 * Agent-loop protocol. A browser that sends `protocol: AGENT_LOOP_PROTOCOL`
 * gets newline-delimited `ChatStreamEvent` JSON instead of plain text, runs
 * the author operations the model calls, and sends their outcomes back so the
 * model sees what happened before it answers. Browsers that don't send it
 * keep the plain-text stream.
 */
export const AGENT_LOOP_PROTOCOL = "agent-loop-1";

/** An author operation the model called; the browser runs it. */
export interface PendingToolCall {
  toolCallId: string;
  toolName: AuthorOperationName;
  input: unknown;
}

/** What the browser reports back for one operation. */
export interface OperationOutcome {
  success: boolean;
  message: string;
  /** Questions the operation created or changed, as they now stand. */
  questions?: Array<{ id: number; type: string; question: string }>;
}

/**
 * One entry in a stored assistant message's `toolCalls`: the call, and its
 * outcome once the browser has run it. Older rows hold `{ function, params }`
 * entries instead, which only drive UI such as the report preview.
 */
export interface StoredToolCall extends PendingToolCall {
  output?: OperationOutcome;
}

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  /** Run these, then continue with their outcomes. */
  | { type: "tool-calls"; calls: PendingToolCall[] }
  /** UI to open with no outcome to report, e.g. the report preview. */
  | {
      type: "client-actions";
      actions: Array<{ function: string; params: unknown }>;
    }
  /** The stored assistant message, for attaching outcomes to it. */
  | { type: "saved"; messageId: number };
