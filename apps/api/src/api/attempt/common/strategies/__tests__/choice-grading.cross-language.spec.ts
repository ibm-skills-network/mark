/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  Choice,
  QuestionDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { GradingContext } from "../../interfaces/grading-context.interface";
import { LocalizationService } from "../../utils/localization.service";
import { ChoiceGradingStrategy } from "../choice-grading.strategy";

/**
 * A learner's choice text can arrive in a different language from the one the
 * submit names: the client builds it from whatever language the attempt was
 * last fetched in. The grader must still recognise the choice the learner
 * picked, as long as some stored rendering of the question contains it.
 */

const authored: Choice[] = [
  { choice: "A normal transaction", points: 0, isCorrect: false },
  { choice: "A data entry error", points: 0, isCorrect: false },
  { choice: "A potential anomaly", points: 1, isCorrect: true },
  { choice: "A delivery delay issue", points: 0, isCorrect: false },
];

const zhCN: Choice[] = [
  { choice: "正常交易", points: 0, isCorrect: false },
  { choice: "数据输入错误", points: 0, isCorrect: false },
  { choice: "潜在的异常", points: 1, isCorrect: true },
  { choice: "交付延迟问题", points: 0, isCorrect: false },
];

const singleQuestion = (choices: Choice[]): QuestionDto =>
  ({
    id: 7463,
    type: QuestionType.SINGLE_CORRECT,
    question: "q",
    totalPoints: 1,
    choices,
  }) as unknown as QuestionDto;

describe("ChoiceGradingStrategy — choices submitted in another language", () => {
  let strategy: ChoiceGradingStrategy;
  const childLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChoiceGradingStrategy,
        {
          provide: LocalizationService,
          useValue: { getLocalizedString: jest.fn((key: string) => key) },
        },
        {
          provide: GRADING_AUDIT_SERVICE,
          useValue: { recordGrading: jest.fn() },
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { child: jest.fn().mockReturnValue(childLogger) },
        },
      ],
    }).compile();
    strategy = module.get(ChoiceGradingStrategy);
  });

  const context = (
    language: string,
    renderings?: { source: string; choices: Choice[]; aligned?: boolean }[],
  ): GradingContext =>
    ({
      assignmentInstructions: "",
      questionAnswerContext: [],
      language,
      ...(renderings
        ? { loadChoiceRenderings: jest.fn().mockResolvedValue(renderings) }
        : {}),
    }) as unknown as GradingContext;

  describe("single correct", () => {
    it("credits a Chinese pick graded against the authored English choices", async () => {
      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["潜在的异常"],
        context("en", [
          { source: "authored", choices: authored },
          { source: "translation:zh-CN", choices: zhCN },
        ]),
      );

      expect(result.totalPoints).toBe(1);
      expect(result.metadata?.isCorrect).toBe(true);
      expect(result.metadata?.error).toBeUndefined();
    });

    it("credits an authored English pick graded against the Chinese translation", async () => {
      const result = await strategy.gradeResponse(
        singleQuestion(zhCN),
        ["A potential anomaly"],
        context("zh-CN", [
          { source: "authored", choices: authored },
          { source: "translation:zh-CN", choices: zhCN },
        ]),
      );

      expect(result.totalPoints).toBe(1);
      expect(result.metadata?.isCorrect).toBe(true);
    });

    it("tolerates whitespace differences in the submitted text", async () => {
      const result = await strategy.gradeResponse(
        singleQuestion(zhCN),
        ["  A   potential anomaly "],
        context("zh-CN", [{ source: "authored", choices: authored }]),
      );

      expect(result.totalPoints).toBe(1);
    });

    it("grades a wrong pick in another language as incorrect, not invalid", async () => {
      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["数据输入错误"],
        context("en", [{ source: "translation:zh-CN", choices: zhCN }]),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.isCorrect).toBe(false);
      expect(result.metadata?.error).toBeUndefined();
    });

    it("still rejects text that matches no stored rendering", async () => {
      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["Something the question never offered"],
        context("en", [{ source: "translation:zh-CN", choices: zhCN }]),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.error).toBe("invalidSelection");
    });

    it("refuses to guess when the text means a right answer in one rendering and a wrong one in another", async () => {
      const confusing: Choice[] = [
        { choice: "A normal transaction", points: 0, isCorrect: false },
        { choice: "A data entry error", points: 0, isCorrect: false },
        { choice: "Ambiguous", points: 1, isCorrect: true },
        { choice: "x", points: 0, isCorrect: false },
      ];
      const other: Choice[] = [
        { choice: "Ambiguous", points: 0, isCorrect: false },
        { choice: "b", points: 0, isCorrect: false },
        { choice: "c", points: 1, isCorrect: true },
        { choice: "d", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["Ambiguous"],
        context("en", [
          { source: "translation:ja", choices: confusing },
          { source: "translation:ko", choices: other, aligned: false },
        ]),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.error).toBe("invalidSelection");
      expect(childLogger.warn).toHaveBeenCalled();
    });

    it("grades against a rendering in another choice order by that rendering's own answer key", async () => {
      // A variant question whose learner was shown the base question's
      // translation: the choices are not in the variant's order.
      const variant: Choice[] = [
        { choice: "An unusual pattern", points: 1, isCorrect: true },
        { choice: "An input mistake", points: 0, isCorrect: false },
        { choice: "A routine order", points: 0, isCorrect: false },
        { choice: "A shipping delay", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        singleQuestion(variant),
        ["潜在的异常"],
        context("en", [
          { source: "authored", choices: variant },
          { source: "base-translation:zh-CN", choices: zhCN, aligned: false },
        ]),
      );

      expect(result.totalPoints).toBe(1);
      expect(result.metadata?.isCorrect).toBe(true);
    });

    it("does not look elsewhere when the text matches the grading language", async () => {
      const ctx = context("en", [
        { source: "translation:zh-CN", choices: zhCN },
      ]);
      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["A potential anomaly"],
        ctx,
      );

      expect(result.totalPoints).toBe(1);
      expect(
        (ctx as unknown as { loadChoiceRenderings: jest.Mock })
          .loadChoiceRenderings,
      ).not.toHaveBeenCalled();
    });

    it("falls back to an invalid selection and logs when the renderings cannot be loaded", async () => {
      const ctx = {
        assignmentInstructions: "",
        questionAnswerContext: [],
        language: "en",
        loadChoiceRenderings: jest.fn().mockRejectedValue(new Error("db down")),
      } as unknown as GradingContext;

      const result = await strategy.gradeResponse(
        singleQuestion(authored),
        ["潜在的异常"],
        ctx,
      );

      expect(result.metadata?.error).toBe("invalidSelection");
      expect(childLogger.error).toHaveBeenCalled();
    });
  });

  describe("multiple correct", () => {
    const multiAuthored: Choice[] = [
      { choice: "Red", points: 1, isCorrect: true },
      { choice: "Blue", points: 1, isCorrect: true },
      { choice: "Green", points: 1, isCorrect: false },
    ];
    const multiJa: Choice[] = [
      { choice: "赤", points: 1, isCorrect: true },
      { choice: "青", points: 1, isCorrect: true },
      { choice: "緑", points: 1, isCorrect: false },
    ];
    const multiQuestion = (choices: Choice[]): QuestionDto =>
      ({
        id: 9,
        type: QuestionType.MULTIPLE_CORRECT,
        question: "q",
        totalPoints: 2,
        choices,
      }) as unknown as QuestionDto;

    it("credits Japanese picks graded against the authored English choices", async () => {
      const result = await strategy.gradeResponse(
        multiQuestion(multiAuthored),
        ["赤", "青"],
        context("en", [{ source: "translation:ja", choices: multiJa }]),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.perfectScore).toBe(true);
    });

    it("credits authored English picks graded against the Japanese translation", async () => {
      const result = await strategy.gradeResponse(
        multiQuestion(multiJa),
        ["Red", "青"],
        context("ja", [{ source: "authored", choices: multiAuthored }]),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.perfectScore).toBe(true);
    });

    it("counts the same choice once when it is submitted in two languages", async () => {
      const lossQuestion = {
        ...multiQuestion(multiAuthored),
        scoring: { type: "LOSS_PER_MISTAKE" },
      } as unknown as QuestionDto;
      const result = await strategy.gradeResponse(
        lossQuestion,
        ["Red", "赤", "Green"],
        context("en", [{ source: "translation:ja", choices: multiJa }]),
      );

      // Red once (+1) and Green (-1), not Red twice.
      expect(result.totalPoints).toBe(0);
    });

    it("does not map through a rendering whose choices are in a different order", async () => {
      const result = await strategy.gradeResponse(
        multiQuestion(multiAuthored),
        ["赤"],
        context("en", [
          { source: "base-translation:ja", choices: multiJa, aligned: false },
        ]),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.feedback?.[0]?.feedback).toContain("invalidSelection");
    });
  });
});
