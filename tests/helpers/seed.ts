/**
 * Seeding + attempt-driving helpers for Playwright E2E.
 *
 * These wrap the REAL api endpoints (direct to the mark api, bypassing the
 * gateway — the same transport `createApiContext` uses) so a spec can stand up
 * an isolated assignment and/or a completed graded attempt against known state.
 *
 * Endpoints used (all under the api global prefix `/api`, URI-versioned):
 *   - POST  /api/v1/admin/assignments               -> create empty assignment
 *   - POST  /api/v1/admin/assignments/:id/content   -> add questions; ALSO
 *           creates version 0.0.1 and PUBLISHES the assignment (so a learner
 *           can immediately attempt it — no separate publish call is needed).
 *   - POST  /api/v2/assignments/:id/attempts        -> create attempt -> { id }
 *   - GET   /api/v2/assignments/:id/attempts/:aid    -> read questions (+ real ids)
 *   - PATCH /api/v2/assignments/:id/attempts/:aid    -> submit -> { gradingJobId }
 *   - GET   /api/v2/assignments/:id/attempts/:aid/grading/:jobId/status-stream
 *           -> SSE; here we POLL the job record to terminal state instead of
 *              consuming the stream (simpler + deterministic for API-level setup).
 *
 * Auth: the api authenticates from a `user-session` header (the gateway injects // pragma: allowlist secret
 * it from the JWT cookie in the browser; for direct api calls we synthesize it
 * with `createUserSessionHeader`). Admin content/create uses role "admin";
 * attempt create/submit uses role "learner" with the learner's identity.
 */
import type { APIRequestContext } from "@playwright/test";
import {
  addContentToAssignment,
  createApiContext,
  createAssignment,
  createUserSessionHeader,
  getTestEnvironmentConfig,
  type TestEnvironmentConfig,
} from "./assignment-helpers";
import type { SeedQuestion } from "./factories/question-factories";

const DEFAULT_LEARNER_USER_ID = "learner@example.com";

/** Per-question answer the learner submits. Shape depends on the question type. */
export type Answer =
  | { kind: "choices"; choices: string[] } // SINGLE_CORRECT / MULTIPLE_CORRECT (choice TEXT)
  | { kind: "boolean"; value: boolean } // TRUE_FALSE
  | { kind: "text"; text: string } // TEXT
  | { kind: "url"; url: string }; // URL

export type SeededAssignment = {
  id: number;
};

const DEFAULT_CONFIG = {
  numAttempts: 3,
  attemptsBeforeCoolDown: 3,
  retakeAttemptCoolDownMinutes: 0,
  passingGrade: 60,
  displayOrder: "DEFINED",
  graded: true,
  questionVariationNumber: 1,
  questionDisplay: "ALL_PER_PAGE",
  showQuestions: true,
  showSubmissionFeedback: true,
  showAssignmentScore: true,
  showQuestionScore: true,
  correctAnswerVisibility: "ALWAYS",
  numberOfQuestionsPerAttempt: null,
  timeEstimateMinutes: 15,
  allotedTimeMinutes: 30,
  attemptsPerTimeRange: null,
  attemptsTimeRangeHours: null,
} as const;

/**
 * Create AND publish an assignment seeded with the given questions, returning
 * its id. The `/content` endpoint auto-publishes, so the assignment is
 * immediately attemptable by a learner. The caller owns the returned context;
 * if none is passed, a fresh one is created and disposed internally.
 */
export async function createSeededAssignment(
  ctx: APIRequestContext | undefined,
  options: {
    questions: SeedQuestion[];
    name?: string;
    type?: string;
    groupId?: string;
    config?: Record<string, unknown>;
    introduction?: string;
    instructions?: string;
    gradingCriteria?: string;
  },
): Promise<SeededAssignment> {
  const envConfig = getTestEnvironmentConfig();
  const ownsContext = !ctx;
  const requestContext = ctx ?? (await createApiContext(envConfig));
  const groupId = options.groupId ?? envConfig.groupId;
  const name = options.name ?? `Seeded Assignment ${Date.now()}`;

  try {
    const assignment = await createAssignment(requestContext, {
      name,
      type: options.type ?? envConfig.assignmentType,
      groupId,
    });

    await addContentToAssignment(requestContext, assignment.id, {
      assignment: {
        name,
        introduction:
          options.introduction ??
          "Seeded by Playwright createSeededAssignment.",
        instructions:
          options.instructions ??
          "Answer every question to the best of your ability.",
      },
      config: { ...DEFAULT_CONFIG, ...(options.config ?? {}) },
      feedbackConfig: {
        verbosityLevel: "detailed",
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showAssignmentScore: true,
        showQuestions: true,
      },
      gradingCriteria:
        options.gradingCriteria ?? "Answers will be graded on correctness.",
      questions: options.questions as unknown as Array<Record<string, unknown>>,
    });

    return { id: assignment.id };
  } finally {
    if (ownsContext) {
      await requestContext.dispose();
    }
  }
}

type AttemptQuestion = {
  id: number;
  type: string;
  question: string;
};

function buildResponseForQuestion(
  question: AttemptQuestion,
  answer: Answer,
): Record<string, unknown> {
  const base = { id: question.id, question: question.question };

  switch (answer.kind) {
    case "choices":
      return { ...base, learnerChoices: answer.choices };
    case "boolean":
      return { ...base, learnerAnswerChoice: answer.value };
    case "text":
      return { ...base, learnerTextResponse: answer.text };
    case "url":
      return { ...base, learnerUrlResponse: answer.url };
    default: {
      const exhaustive: never = answer;
      throw new Error(`Unhandled answer kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function fetchAttemptQuestions(
  requestContext: APIRequestContext,
  assignmentId: number,
  attemptId: number,
  userId: string,
  groupId: string,
): Promise<AttemptQuestion[]> {
  const response = await requestContext.get(
    `/api/v2/assignments/${assignmentId}/attempts/${attemptId}?lang=en`,
    {
      headers: createUserSessionHeader("learner", {
        userId,
        groupId,
        assignmentId,
      }),
    },
  );

  if (!response.ok()) {
    throw new Error(
      `Failed to read attempt ${attemptId} (${response.status()}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { questions?: AttemptQuestion[] };
  if (!Array.isArray(body.questions)) {
    throw new Error(`Attempt ${attemptId} returned no questions array.`);
  }

  return body.questions;
}

export type DriveAttemptResult = {
  attemptId: number;
  gradingJobId: string;
};

/**
 * Create a learner attempt and submit answers via the REAL v2 attempt API.
 * `answers` is positional: answers[i] corresponds to the i-th seeded question
 * (the order they were passed to createSeededAssignment). Returns the attempt
 * id and the grading job id (grading is async — see waitForGradingComplete).
 */
export async function driveAttempt(
  ctx: APIRequestContext | undefined,
  options: {
    assignmentId: number;
    answers: Answer[];
    userId?: string;
    groupId?: string;
  },
): Promise<DriveAttemptResult> {
  const envConfig = getTestEnvironmentConfig();
  const ownsContext = !ctx;
  const requestContext = ctx ?? (await createApiContext(envConfig));
  const userId = options.userId ?? DEFAULT_LEARNER_USER_ID;
  const groupId = options.groupId ?? envConfig.groupId;
  const { assignmentId } = options;

  try {
    const createResponse = await requestContext.post(
      `/api/v2/assignments/${assignmentId}/attempts`,
      {
        headers: createUserSessionHeader("learner", {
          userId,
          groupId,
          assignmentId,
        }),
      },
    );

    if (!createResponse.ok()) {
      throw new Error(
        `Failed to create attempt for assignment ${assignmentId} (${createResponse.status()}): ${await createResponse.text()}`,
      );
    }

    const { id: attemptId } = (await createResponse.json()) as { id: number };

    const questions = await fetchAttemptQuestions(
      requestContext,
      assignmentId,
      attemptId,
      userId,
      groupId,
    );

    if (questions.length !== options.answers.length) {
      throw new Error(
        `driveAttempt: ${options.answers.length} answers provided but attempt has ${questions.length} questions.`,
      );
    }

    const responsesForQuestions = questions.map((question, index) =>
      buildResponseForQuestion(question, options.answers[index]),
    );

    const submitResponse = await requestContext.patch(
      `/api/v2/assignments/${assignmentId}/attempts/${attemptId}`,
      {
        headers: createUserSessionHeader("learner", {
          userId,
          groupId,
          assignmentId,
        }),
        data: {
          submitted: true,
          responsesForQuestions,
          language: "en",
        },
      },
    );

    if (!submitResponse.ok()) {
      throw new Error(
        `Failed to submit attempt ${attemptId} (${submitResponse.status()}): ${await submitResponse.text()}`,
      );
    }

    const submitBody = (await submitResponse.json()) as {
      gradingJobId?: string;
    };

    if (!submitBody.gradingJobId) {
      throw new Error(
        `Submit of attempt ${attemptId} returned no gradingJobId: ${JSON.stringify(submitBody)}`,
      );
    }

    return { attemptId, gradingJobId: submitBody.gradingJobId };
  } finally {
    if (ownsContext) {
      await requestContext.dispose();
    }
  }
}

export type GradingTerminalState = {
  status: "Completed" | "Failed";
  result?: unknown;
};

/**
 * Poll the grading job to a terminal state (Completed | Failed) by consuming
 * the SSE status-stream and resolving on the first terminal event. The api
 * marks jobs "Completed"/"Failed" (job-state.service isTerminalStatus). This is
 * the API-level equivalent of the UI waiting on the EventSource; in a browser
 * spec you should instead await the SSE-driven URL transition
 * (`await expect(page).toHaveURL(/successPage/)`).
 */
export async function waitForGradingComplete(
  ctx: APIRequestContext | undefined,
  options: {
    assignmentId: number;
    attemptId: number;
    gradingJobId: string;
    userId?: string;
    groupId?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<GradingTerminalState> {
  const envConfig = getTestEnvironmentConfig();
  const ownsContext = !ctx;
  const requestContext = ctx ?? (await createApiContext(envConfig));
  const userId = options.userId ?? DEFAULT_LEARNER_USER_ID;
  const groupId = options.groupId ?? envConfig.groupId;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 750;
  const deadline = Date.now() + timeoutMs;

  try {
    // The status-stream is SSE; for API-level setup we re-read the attempt's
    // grading progress endpoint until terminal. Objective-only attempts settle
    // almost immediately (rule-based, no LLM).
    for (;;) {
      const response = await requestContext.get(
        `/api/v2/assignments/${options.assignmentId}/attempts/${options.attemptId}/progress`,
        {
          headers: createUserSessionHeader("learner", {
            userId,
            groupId,
            assignmentId: options.assignmentId,
          }),
        },
      );

      if (response.ok()) {
        // The /progress row carries the Prisma GradingStatus enum
        // (PENDING | PROCESSING | COMPLETED | FAILED).
        const progress = (await response.json()) as {
          status?: string;
          [key: string]: unknown;
        };
        const status = String(progress.status ?? "").toUpperCase();
        if (status === "COMPLETED") {
          return { status: "Completed", result: progress };
        }
        if (status === "FAILED") {
          return { status: "Failed", result: progress };
        }
      } else if (response.status() === 404) {
        // No progress row yet (or already cleared after completion) — fall back
        // to the completed-attempt endpoint to confirm the grade landed.
        const completed = await requestContext.get(
          `/api/v2/assignments/${options.assignmentId}/attempts/${options.attemptId}/completed`,
          {
            headers: createUserSessionHeader("learner", {
              userId,
              groupId,
              assignmentId: options.assignmentId,
            }),
          },
        );
        if (completed.ok()) {
          const body = (await completed.json()) as { submitted?: boolean };
          if (body.submitted) {
            return { status: "Completed", result: body };
          }
        }
      }

      if (Date.now() > deadline) {
        throw new Error(
          `Grading job ${options.gradingJobId} for attempt ${options.attemptId} did not reach a terminal state within ${timeoutMs}ms.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  } finally {
    if (ownsContext) {
      await requestContext.dispose();
    }
  }
}

export type SeededCompletedAttempt = {
  assignmentId: number;
  attemptId: number;
  gradingJobId: string;
  grading: GradingTerminalState;
};

/**
 * End-to-end setup: create+publish an assignment, drive a learner attempt with
 * the given answers, and wait for grading to finish — so attempt-history /
 * feedback UI can be asserted against known, settled state.
 *
 * Use OBJECTIVE questions (singleCorrect / multipleCorrect / trueFalse) when you
 * intend to assert on the score VALUE; open types settle but their score is
 * LLM-driven and non-deterministic.
 */
export async function seedCompletedAttempt(
  ctx: APIRequestContext | undefined,
  options: {
    questions: SeedQuestion[];
    answers: Answer[];
    name?: string;
    type?: string;
    groupId?: string;
    userId?: string;
    config?: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<SeededCompletedAttempt> {
  const envConfig = getTestEnvironmentConfig();
  const ownsContext = !ctx;
  const requestContext = ctx ?? (await createApiContext(envConfig));

  try {
    const assignment = await createSeededAssignment(requestContext, {
      questions: options.questions,
      name: options.name,
      type: options.type,
      groupId: options.groupId,
      config: options.config,
    });

    const { attemptId, gradingJobId } = await driveAttempt(requestContext, {
      assignmentId: assignment.id,
      answers: options.answers,
      userId: options.userId,
      groupId: options.groupId,
    });

    const grading = await waitForGradingComplete(requestContext, {
      assignmentId: assignment.id,
      attemptId,
      gradingJobId,
      userId: options.userId,
      groupId: options.groupId,
      timeoutMs: options.timeoutMs,
    });

    return {
      assignmentId: assignment.id,
      attemptId,
      gradingJobId,
      grading,
    };
  } finally {
    if (ownsContext) {
      await requestContext.dispose();
    }
  }
}

/**
 * Best-effort teardown: delete a seeded assignment so isolated tests don't leak
 * state. Uses the admin delete endpoint. Swallows failures (the assignment may
 * already be gone) but logs, so a flaky teardown never fails a test.
 */
export async function deleteSeededAssignment(
  ctx: APIRequestContext | undefined,
  assignmentId: number,
  envConfig: TestEnvironmentConfig = getTestEnvironmentConfig(),
): Promise<void> {
  const ownsContext = !ctx;
  const requestContext = ctx ?? (await createApiContext(envConfig));
  try {
    const response = await requestContext.delete(
      `/api/v1/admin/assignments/${assignmentId}`,
      {
        headers: createUserSessionHeader("admin", {
          userId: envConfig.adminEmail,
          groupId: envConfig.groupId,
          assignmentId,
        }),
      },
    );
    if (!response.ok()) {
      // eslint-disable-next-line no-console
      console.warn(
        `deleteSeededAssignment: assignment ${assignmentId} delete returned ${response.status()} (ignored).`,
      );
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `deleteSeededAssignment: failed to delete assignment ${assignmentId} (ignored):`,
      error instanceof Error ? error.message : error,
    );
  } finally {
    if (ownsContext) {
      await requestContext.dispose();
    }
  }
}
