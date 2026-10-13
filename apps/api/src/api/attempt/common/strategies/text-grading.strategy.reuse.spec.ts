import { QuestionType } from "@prisma/client";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { deriveLearnerKey } from "../../../assignment/v2/services/grading-consistency.service";
import { TextGradingStrategy } from "./text-grading.strategy";

interface ReuseLookup {
  questionType: QuestionType;
  maxPoints?: number;
  modelIdentity?: string;
  learnerKey?: string;
  attemptId?: number;
}

interface ConsistencyResult {
  similar: boolean;
  previousGrade?: number;
  previousFeedback?: unknown;
  shouldAdjust: boolean;
  reuseReason?: string;
}

const QUESTION = {
  id: 8620,
  type: QuestionType.TEXT,
  question: "Provide the SQL statement that creates the index.",
  totalPoints: 1,
  responseType: "CODE",
  scoring: undefined,
};

const LEARNER = "learner@example.com";
const ANSWER = "CREATE INDEX idx_billed ON billdata(billedamount);";

/** `unresolvedModel` stands for a grading model the facade could not name. */
const unresolvedModel = Symbol("unresolved grading model");

function buildStrategy(
  consistencyResult: ConsistencyResult,
  modelIdentity: string | typeof unresolvedModel = "model@rev",
) {
  const checkConsistency = jest.fn().mockResolvedValue(consistencyResult);
  const gradeTextBasedQuestion = jest
    .fn()
    .mockResolvedValue({ points: 1, feedback: "graded fresh", metadata: {} });

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const strategy = Object.create(
    TextGradingStrategy.prototype,
  ) as TextGradingStrategy & Record<string, unknown>;

  strategy.logger = logger;
  strategy.consistencyService = {
    generateResponseHash: jest.fn().mockReturnValue("hash-of-answer"),
    checkConsistency,
  };
  strategy.llmFacadeService = {
    getTextGradingModelIdentity: jest
      .fn()
      .mockResolvedValue(
        modelIdentity === unresolvedModel ? undefined : modelIdentity,
      ),
    gradeTextBasedQuestion,
  };
  strategy.recordGrading = jest.fn();

  return { strategy, checkConsistency, gradeTextBasedQuestion, logger };
}

async function reuse(
  strategy: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const tryReuse = strategy.tryReuseFromConsistency as (
    question: unknown,
    answer: string,
    context: unknown,
  ) => Promise<{ totalPoints: number } | null>;
  return tryReuse.call(strategy, QUESTION, ANSWER, context);
}

describe("TextGradingStrategy prior-grade reuse", () => {
  it("looks up prior grades with server-derived identity, not request data", async () => {
    const { strategy, checkConsistency } = buildStrategy({
      similar: false,
      shouldAdjust: false,
    });

    await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      assignmentId: 2645,
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    });

    expect(checkConsistency).toHaveBeenCalledTimes(1);
    const lookup = checkConsistency.mock.calls[0][3] as ReuseLookup;
    expect(lookup.questionType).toBe(QuestionType.TEXT);
    expect(lookup.maxPoints).toBe(QUESTION.totalPoints);
    expect(lookup.attemptId).toBe(1_503_465);
    expect(lookup.learnerKey).toBe(deriveLearnerKey(LEARNER));
    expect(JSON.stringify(lookup)).not.toContain(LEARNER);
  });

  it("grades again rather than serving a prior grade below full marks", async () => {
    const { strategy } = buildStrategy({
      similar: true,
      previousGrade: 0,
      previousFeedback: "prior feedback",
      shouldAdjust: false,
      reuseReason: "exact_match",
    });

    const result = await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    });

    expect(result).toBeNull();
  });

  it("serves a prior grade that awarded full marks", async () => {
    const { strategy, logger } = buildStrategy({
      similar: true,
      previousGrade: 1,
      previousFeedback: "prior feedback",
      shouldAdjust: false,
      reuseReason: "exact_match",
    });

    const result = await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    });

    expect(result?.totalPoints).toBe(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        questionId: QUESTION.id,
        attemptId: 1_503_465,
        reason: "exact_match",
      }),
    );
  });

  it("never awards more than the question is worth", async () => {
    // A grade recorded when the question was worth 20 points, replayed after
    // the author lowered it to 1.
    const { strategy } = buildStrategy({
      similar: true,
      previousGrade: 20,
      previousFeedback: "prior feedback",
      shouldAdjust: false,
      reuseReason: "exact_match",
    });

    const result = await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    });

    expect(result?.totalPoints).toBe(QUESTION.totalPoints);
  });

  it("does not look up prior grades for an author preview", async () => {
    // An author preview grades the question body carried in the request, so it
    // must neither read nor write the shared grading history.
    const { strategy, checkConsistency } = buildStrategy({
      similar: true,
      previousGrade: 1,
      previousFeedback: "prior feedback",
      shouldAdjust: false,
      reuseReason: "exact_match",
    });

    const result = await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.AUTHOR,
      userId: "author@example.com",
      attemptId: 1_503_466,
    });

    expect(result).toBeNull();
    expect(checkConsistency).not.toHaveBeenCalled();
  });

  it("does not reuse a grade when the grading model cannot be identified", async () => {
    const { strategy, checkConsistency } = buildStrategy(
      {
        similar: true,
        previousGrade: 1,
        previousFeedback: "prior feedback",
        shouldAdjust: false,
        reuseReason: "exact_match",
      },
      unresolvedModel,
    );

    const result = await reuse(strategy as unknown as Record<string, unknown>, {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    });

    expect(result).toBeNull();
    expect(checkConsistency).not.toHaveBeenCalled();
  });

  describe("feedback on a reused grade", () => {
    const LEARNER_CONTEXT = {
      assignmentInstructions: "",
      questionAnswerContext: [],
      userRole: UserRole.LEARNER,
      userId: LEARNER,
      attemptId: 1_503_465,
    };

    const STRUCTURED = {
      summary: "You earned 1/1. 1 of 1 criteria were fully met.",
      criteria: [
        {
          name: "Creates the index",
          pointsAwarded: 1,
          maxPoints: 1,
          status: "full",
          evidence: "CREATE INDEX idx_billed ON billdata(billedamount);",
          feedback: "Correct column.",
        },
      ],
      guidance: "Nothing to add.",
    };

    type ReusedFeedback = Array<{
      feedback: string;
      structuredFeedback?: unknown;
    }>;

    async function reusedFeedback(previousFeedback: unknown) {
      const built = buildStrategy({
        similar: true,
        previousGrade: 1,
        previousFeedback,
        shouldAdjust: false,
        reuseReason: "exact_match",
      });
      const result = (await reuse(
        built.strategy as unknown as Record<string, unknown>,
        LEARNER_CONTEXT,
      )) as { totalPoints: number; feedback: ReusedFeedback } | null;
      return { result, logger: built.logger };
    }

    it("keeps the prior grade's structured feedback and appends the reuse note", async () => {
      const { result } = await reusedFeedback([
        {
          feedback: "Score: 1/1 points (100%).",
          structuredFeedback: STRUCTURED,
        },
      ]);

      expect(result?.totalPoints).toBe(1);
      expect(result?.feedback).toHaveLength(1);
      const [entry] = result?.feedback ?? [];
      expect(entry.structuredFeedback).toEqual(STRUCTURED);
      expect(entry.feedback.startsWith("[")).toBe(false);
      expect(entry.feedback).toBe(
        "Score: 1/1 points (100%).\n\n**Score Rationale:** Reused prior grade (1/1).",
      );
    });

    it("does not alter the prior grade's own feedback entries", async () => {
      const prior = [
        {
          feedback: "Score: 1/1 points (100%).",
          structuredFeedback: STRUCTURED,
        },
      ];

      await reusedFeedback(prior);

      expect(prior[0].feedback).toBe("Score: 1/1 points (100%).");
    });

    it("falls back to a plain note and warns when the prior feedback is unusable", async () => {
      const { result, logger } = await reusedFeedback(undefined);

      expect(result?.totalPoints).toBe(1);
      expect(result?.feedback).toEqual([
        {
          feedback:
            "Reused prior grading result for identical answer.\n\n**Score Rationale:** Reused prior grade (1/1).",
        },
      ]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ questionId: QUESTION.id }),
      );
    });
  });
});
