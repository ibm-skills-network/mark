import { QuestionType } from "@prisma/client";
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
  previousFeedback?: string;
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

function buildStrategy(consistencyResult: ConsistencyResult) {
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
    getTextGradingModelIdentity: jest.fn().mockResolvedValue("model@rev"),
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
});
