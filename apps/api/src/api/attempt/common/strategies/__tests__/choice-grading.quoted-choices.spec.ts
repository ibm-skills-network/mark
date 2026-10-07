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
 * Authors sometimes wrap a whole choice in quotation marks. Older learner
 * clients dropped the outer pair when they decoded the choice, so the learner
 * submits the text without them. The grader must still recognise the pick,
 * as long as exactly one choice matches once the quotes are set aside.
 */

const quoted: Choice[] = [
  {
    choice:
      '"We are very error-prone and constantly have to go back to check/fix work."',
    points: 1,
    isCorrect: true,
  },
  {
    choice: '"We rarely make mistakes."',
    points: 0,
    isCorrect: false,
  },
  {
    choice: '"We automate every check."',
    points: 0,
    isCorrect: false,
  },
];

const curly: Choice[] = [
  { choice: "“A potential anomaly”", points: 2, isCorrect: true },
  { choice: "“A normal transaction”", points: 0, isCorrect: false },
];

const question = (
  choices: Choice[],
  type: QuestionType = QuestionType.SINGLE_CORRECT,
  totalPoints = 1,
): QuestionDto =>
  ({
    id: 12_218,
    type,
    question: "q",
    totalPoints,
    choices,
  }) as unknown as QuestionDto;

describe("ChoiceGradingStrategy — choices wrapped in quotation marks", () => {
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
    language = "en",
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
    it("credits the correct pick submitted without the author's straight quotes", async () => {
      const result = await strategy.gradeResponse(
        question(quoted),
        [
          "We are very error-prone and constantly have to go back to check/fix work.",
        ],
        context(),
      );

      expect(result.totalPoints).toBe(1);
      expect(result.metadata?.isCorrect).toBe(true);
      expect(result.metadata?.error).toBeUndefined();
    });

    it("credits the correct pick submitted without the author's curly quotes", async () => {
      const result = await strategy.gradeResponse(
        question(curly, QuestionType.SINGLE_CORRECT, 2),
        ["A potential anomaly"],
        context(),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.isCorrect).toBe(true);
    });

    it("grades a wrong pick submitted without quotes as incorrect, not invalid", async () => {
      const result = await strategy.gradeResponse(
        question(quoted),
        ["We rarely make mistakes."],
        context(),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.isCorrect).toBe(false);
      expect(result.metadata?.error).toBeUndefined();
    });

    it("still matches the choice submitted with its quotes intact", async () => {
      const result = await strategy.gradeResponse(
        question(quoted),
        [
          '"We are very error-prone and constantly have to go back to check/fix work."',
        ],
        context(),
      );

      expect(result.totalPoints).toBe(1);
    });

    it("credits a quoted pick when renderings are loaded for the question", async () => {
      const result = await strategy.gradeResponse(
        question(quoted),
        [
          "We are very error-prone and constantly have to go back to check/fix work.",
        ],
        context("en", [{ source: "authored", choices: quoted }]),
      );

      expect(result.totalPoints).toBe(1);
    });

    it("prefers an exact match over a choice that only matches without quotes", async () => {
      const choices: Choice[] = [
        { choice: '"yes"', points: 1, isCorrect: true },
        { choice: "yes", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        question(choices),
        ["yes"],
        context(),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.isCorrect).toBe(false);
      expect(result.metadata?.error).toBeUndefined();
    });

    it("refuses to guess when two choices only differ by their quotes", async () => {
      const choices: Choice[] = [
        { choice: '"yes"', points: 1, isCorrect: true },
        { choice: "“yes”", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        question(choices),
        ["yes"],
        context(),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.error).toBe("invalidSelection");
      expect(childLogger.warn).toHaveBeenCalled();
    });

    it("does not treat inner quotation marks as optional", async () => {
      const choices: Choice[] = [
        { choice: 'Print "hello"', points: 1, isCorrect: true },
        { choice: "Print hello", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        question(choices),
        ["Print hello"],
        context(),
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.isCorrect).toBe(false);
    });

    it("credits a translated quoted pick submitted without quotes", async () => {
      const zh: Choice[] = [
        { choice: "“潜在的异常”", points: 2, isCorrect: true },
        { choice: "“正常交易”", points: 0, isCorrect: false },
      ];
      const result = await strategy.gradeResponse(
        question(curly, QuestionType.SINGLE_CORRECT, 2),
        ["潜在的异常"],
        context("en", [
          { source: "authored", choices: curly },
          { source: "translation:zh-CN", choices: zh },
        ]),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.isCorrect).toBe(true);
    });
  });

  describe("multiple correct", () => {
    const multi: Choice[] = [
      { choice: '"Alpha is first."', points: 1, isCorrect: true },
      { choice: '"Beta is second."', points: 1, isCorrect: true },
      { choice: '"Gamma is wrong."', points: 1, isCorrect: false },
    ];

    it("credits every correct pick submitted without quotes", async () => {
      const result = await strategy.gradeResponse(
        question(multi, QuestionType.MULTIPLE_CORRECT, 2),
        ["Alpha is first.", "Beta is second."],
        context(),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.perfectScore).toBe(true);
    });

    it("credits quoted picks when renderings are loaded for the question", async () => {
      const result = await strategy.gradeResponse(
        question(multi, QuestionType.MULTIPLE_CORRECT, 2),
        ["Alpha is first.", "Beta is second."],
        context("en", [{ source: "authored", choices: multi }]),
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.perfectScore).toBe(true);
    });

    it("counts a choice submitted both with and without quotes once", async () => {
      const result = await strategy.gradeResponse(
        question(multi, QuestionType.MULTIPLE_CORRECT, 2),
        ['"Alpha is first."', "Alpha is first."],
        context(),
      );

      expect(result.totalPoints).toBe(1);
    });
  });
});
