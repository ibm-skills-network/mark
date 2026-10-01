import { QuestionType } from "@prisma/client";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { TextGradingStrategy } from "./text-grading.strategy";

const QUESTION = {
  id: 8620,
  type: QuestionType.TEXT,
  question: "Provide the SQL statement that creates the index.",
  totalPoints: 20,
  responseType: "CODE",
  scoring: undefined,
};

const ANSWER = "CREATE INDEX idx_billed ON billdata(billedamount);";

function buildStrategy() {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };

  const auditRecordGrading = jest.fn().mockResolvedValue(undefined);
  const consistencyRecordGrading = jest.fn().mockResolvedValue(undefined);
  const checkConsistency = jest
    .fn()
    .mockResolvedValue({ similar: false, shouldAdjust: false });

  const strategy = Object.create(
    TextGradingStrategy.prototype,
  ) as TextGradingStrategy & Record<string, unknown>;

  strategy.logger = logger;
  strategy.gradingAuditService = { recordGrading: auditRecordGrading };
  strategy.consistencyService = {
    generateResponseHash: jest.fn().mockReturnValue("hash-of-answer"),
    checkConsistency,
    recordGrading: consistencyRecordGrading,
  };
  strategy.llmFacadeService = {
    getTextGradingModelIdentity: jest.fn().mockResolvedValue("model@rev"),
  };

  return {
    strategy,
    auditRecordGrading,
    consistencyRecordGrading,
    checkConsistency,
  };
}

async function record(
  strategy: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  const recordGrading = strategy.recordGrading as (
    question: unknown,
    requestDto: unknown,
    responseDto: unknown,
    context: unknown,
    gradingStrategy: string,
  ) => Promise<void>;

  const responseDto = {
    totalPoints: QUESTION.totalPoints,
    feedback: [{ feedback: "graded" }],
    metadata: {},
  };

  await recordGrading.call(
    strategy,
    QUESTION,
    { learnerTextResponse: ANSWER },
    responseDto,
    context,
    "TextGradingStrategy",
  );
}

const LEARNER_CONTEXT = {
  assignmentInstructions: "",
  questionAnswerContext: [],
  assignmentId: 2645,
  userRole: UserRole.LEARNER,
  userId: "learner@example.com",
  attemptId: 1_503_465,
};

const AUTHOR_CONTEXT = {
  ...LEARNER_CONTEXT,
  userRole: UserRole.AUTHOR,
  userId: "author@example.com",
};

describe("TextGradingStrategy grading record", () => {
  it("records the maximum the grade was scored out of", async () => {
    // Without it, a later reuse cannot tell full marks from a score out of a
    // total the author has since changed.
    const { strategy, auditRecordGrading } = buildStrategy();

    await record(
      strategy as unknown as Record<string, unknown>,
      LEARNER_CONTEXT,
    );

    expect(auditRecordGrading).toHaveBeenCalledTimes(1);
    const record_ = auditRecordGrading.mock.calls[0][0] as {
      metadata: { maxPoints?: number; userRole?: string };
    };
    expect(record_.metadata.maxPoints).toBe(QUESTION.totalPoints);
    expect(record_.metadata.userRole).toBe(UserRole.LEARNER);
  });

  it("keeps a learner grading in the in-session history", async () => {
    const { strategy, consistencyRecordGrading } = buildStrategy();

    await record(
      strategy as unknown as Record<string, unknown>,
      LEARNER_CONTEXT,
    );

    expect(consistencyRecordGrading).toHaveBeenCalledTimes(1);
  });

  it("keeps an author preview out of the in-session history", async () => {
    // The preview grades a question body taken from the request, so its score
    // must never be served to a learner answering the real question.
    const { strategy, consistencyRecordGrading, checkConsistency } =
      buildStrategy();

    await record(
      strategy as unknown as Record<string, unknown>,
      AUTHOR_CONTEXT,
    );

    expect(consistencyRecordGrading).not.toHaveBeenCalled();
    expect(checkConsistency).not.toHaveBeenCalled();
  });
});
