import { RetryableUrlFetchError } from "src/api/llm/features/grading/errors/retryable-url-fetch.error";
import { QuestionType } from "@prisma/client";
import {
  GradingConsistencyService,
  deriveLearnerKey,
} from "src/api/assignment/v2/services/grading-consistency.service";
import { AttemptQuestionsMapper } from "src/api/attempt/common/utils/attempt-questions-mapper.util";
import { TranslationService } from "src/api/attempt/services/translation/translation.service";
import { ChoiceGradingStrategy } from "src/api/attempt/common/strategies/choice-grading.strategy";
import {
  fetchUrlContentForGrading,
  clearGithubDefaultBranchCache,
} from "src/api/attempt/common/utils/github-content-fetch.util";
import { safeGet } from "src/api/attempt/common/utils/ssrf-safe-http";

jest.mock("src/api/attempt/common/utils/ssrf-safe-http", () => ({
  safeGet: jest.fn(),
}));
const logger: any = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
logger.child = () => logger;

describe("Grading boundaries", () => {
  test.each([
    ["x > 0 AND y > 0", "x > 0 OR y > 0"],
    ["1.5", "15"],
    ["CaseSensitive", "casesensitive"],
    [
      "prefix ".repeat(150) + "correct ending",
      "prefix ".repeat(150) + "wrong ending",
    ],
  ])(
    "does not reuse full marks across learners for different answers (%s)",
    async (correct, wrong) => {
      const row = {
        id: 1,
        requestPayload: JSON.stringify({ learnerTextResponse: correct }),
        responsePayload: JSON.stringify({
          totalPoints: 10,
          feedback: "correct",
        }),
        metadata: JSON.stringify({
          modelSnapshot: "model",
          userRole: "learner",
          learnerKey: deriveLearnerKey("alice@example.com"),
          maxPoints: 10,
        }),
      };
      const service = new GradingConsistencyService(
        {
          gradingAudit: { findMany: jest.fn().mockResolvedValue([row]) },
        } as any,
        logger,
      );
      try {
        const hash = service.generateResponseHash(wrong, 42, QuestionType.TEXT);
        expect(hash).not.toBe(
          service.generateResponseHash(correct, 42, QuestionType.TEXT),
        );
        const result = await service.checkConsistency(42, hash, wrong, {
          questionType: QuestionType.TEXT,
          maxPoints: 10,
          modelIdentity: "model",
          learnerKey: deriveLearnerKey("bob@example.com"),
        });
        expect(result).toMatchObject({ similar: false });
        await service.recordGrading(
          42,
          service.generateResponseHash(correct, 42, QuestionType.TEXT),
          10,
          10,
          "correct",
          undefined,
          "model",
        );
        expect(
          await service.checkConsistency(42, hash, wrong, {
            questionType: QuestionType.TEXT,
            maxPoints: 10,
            modelIdentity: "model",
            learnerKey: deriveLearnerKey("bob@example.com"),
          }),
        ).toMatchObject({ similar: false });
      } finally {
        service.onModuleDestroy();
      }
    },
  );

  test("grades a displayed regional fallback choice against the same translation", async () => {
    const q: any = {
      id: 42,
      assignmentId: 500,
      question: "Pick red",
      type: QuestionType.SINGLE_CORRECT,
      totalPoints: 1,
      choices: [
        { id: 11, choice: "Red", isCorrect: true, points: 1 },
        { id: 12, choice: "Blue", isCorrect: false, points: 0 },
      ],
    };
    const translated = {
      translatedText: "选择红色",
      translatedChoices: [
        { id: 11, choice: "红色", isCorrect: true, points: 1 },
        { id: 12, choice: "蓝色", isCorrect: false, points: 0 },
      ],
    };
    const rows = [
      { questionId: 42, variantId: null, languageCode: "zh-CN", ...translated },
    ];
    const prisma: any = {
      translation: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const service = new TranslationService(prisma, {} as any);
    const attempt: any = { questionVariants: [], questionOrder: [42] };
    const map = await service.getTranslationsForAttempt(attempt, [q], "zh-tw");
    const shown = await AttemptQuestionsMapper.buildQuestionsWithTranslations(
      attempt,
      { questions: [q], questionOrder: [42] } as any,
      map,
      "zh-tw",
    );
    expect(shown[0].choices[0].choice).toBe("红色");
    const forGrading = await service.applyTranslationToQuestion(
      { ...q },
      "zh-TW",
    );
    const grader = new ChoiceGradingStrategy(
      { getLocalizedString: (s: string) => s } as any,
      {} as any,
      logger,
    );
    const result = await grader.handleResponse(
      forGrading,
      { learnerChoices: ["红色"] } as any,
      { language: "zh-TW" } as any,
    );
    expect(result.responseDto).toMatchObject({
      totalPoints: 1,
      metadata: { isCorrect: true },
    });
  });

  test("retries a GitHub repo when every upstream is unavailable", async () => {
    clearGithubDefaultBranchCache();
    (safeGet as jest.Mock).mockRejectedValue({
      response: { status: 503, headers: {} },
      message: "service unavailable",
    });
    await expect(
      fetchUrlContentForGrading("https://github.com/review/repo"),
    ).rejects.toBeInstanceOf(RetryableUrlFetchError);
  });
});
