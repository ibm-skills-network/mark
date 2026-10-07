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
 * Older learner clients read numeric-looking choice text as a JSON number
 * before submitting it, so "1.620" arrived as "1.62" and "4.0" as "4". The
 * grader recognises that exact rewrite when it points at a single choice,
 * and never guesses otherwise.
 */

const question = (
  type: QuestionType,
  choices: Choice[],
  totalPoints: number,
): QuestionDto =>
  ({
    id: 9447,
    type,
    question: "q",
    totalPoints,
    choices,
  }) as unknown as QuestionDto;

const variantChoices: Choice[] = [
  { choice: "1.621", points: 0, isCorrect: false },
  { choice: "1.692", points: 2, isCorrect: true },
  { choice: "1.620", points: 0, isCorrect: false },
  { choice: "1.653", points: 0, isCorrect: false },
];

const baseChoices: Choice[] = [
  { choice: "1.620396", points: 0, isCorrect: false },
  { choice: "1.691667", points: 2, isCorrect: true },
  { choice: "1.620128", points: 0, isCorrect: false },
  { choice: "1.693353", points: 0, isCorrect: false },
];

const wholeNumberChoices: Choice[] = [
  { choice: "4.1", points: 0, isCorrect: false },
  { choice: "27.0", points: 1, isCorrect: true },
  { choice: "3.0", points: 0, isCorrect: false },
  { choice: "1.0", points: 0, isCorrect: false },
];

describe("ChoiceGradingStrategy — numeric choice text rewritten by the client", () => {
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

  const context = {
    assignmentInstructions: "",
    questionAnswerContext: [],
    language: "en",
  } as unknown as GradingContext;

  describe("single correct", () => {
    it("maps a dropped trailing zero back to the one choice it came from", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.SINGLE_CORRECT, variantChoices, 2),
        ["1.62"],
        context,
      );

      expect(result.metadata?.error).toBeUndefined();
      expect(result.metadata?.isCorrect).toBe(false);
      expect(result.totalPoints).toBe(0);
    });

    it("credits a correct whole-number choice submitted without its .0", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.SINGLE_CORRECT, wholeNumberChoices, 1),
        ["27"],
        context,
      );

      expect(result.metadata?.isCorrect).toBe(true);
      expect(result.totalPoints).toBe(1);
      expect(childLogger.info).toHaveBeenCalledWith(
        "Matched a numerically rewritten choice to the authored text",
        expect.objectContaining({ questionId: 9447 }),
      );
    });

    it("accepts the rewrite when it arrives as a JSON number", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.SINGLE_CORRECT, wholeNumberChoices, 1),
        [27 as unknown as string],
        context,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("does not round: 1.62 is not 1.620396", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.SINGLE_CORRECT, baseChoices, 2),
        ["1.62"],
        context,
      );

      expect(result.metadata?.error).toBe("invalidSelection");
      expect(result.totalPoints).toBe(0);
    });

    it("refuses to choose between two choices that rewrite to the same number", async () => {
      const result = await strategy.gradeResponse(
        question(
          QuestionType.SINGLE_CORRECT,
          [
            { choice: "4.0", points: 1, isCorrect: true },
            { choice: "4.00", points: 0, isCorrect: false },
            { choice: "5", points: 0, isCorrect: false },
          ],
          1,
        ),
        ["4"],
        context,
      );

      expect(result.metadata?.error).toBe("invalidSelection");
      expect(result.totalPoints).toBe(0);
      expect(childLogger.warn).toHaveBeenCalledWith(
        "Numerically rewritten choice matches more than one choice; grading it as an invalid selection",
        expect.objectContaining({ questionId: 9447 }),
      );
    });

    it("only accepts the exact JSON number form, not other spellings", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.SINGLE_CORRECT, wholeNumberChoices, 1),
        ["27.00"],
        context,
      );

      expect(result.metadata?.error).toBe("invalidSelection");
    });
  });

  describe("multiple correct", () => {
    const choices: Choice[] = [
      { choice: "1.50", points: 1, isCorrect: true },
      { choice: "2.0", points: 1, isCorrect: true },
      { choice: "3", points: 1, isCorrect: false },
    ];

    it("maps each rewritten pick to its authored choice", async () => {
      const result = await strategy.gradeResponse(
        question(QuestionType.MULTIPLE_CORRECT, choices, 2),
        ["1.5", "2"],
        context,
      );

      expect(result.totalPoints).toBe(2);
      expect(result.metadata?.perfectScore).toBe(true);
    });

    it("leaves an ambiguous rewrite unmatched", async () => {
      const result = await strategy.gradeResponse(
        question(
          QuestionType.MULTIPLE_CORRECT,
          [
            { choice: "1.50", points: 1, isCorrect: true },
            { choice: "1.500", points: 1, isCorrect: false },
          ],
          1,
        ),
        ["1.5"],
        context,
      );

      expect(result.totalPoints).toBe(0);
      expect(result.metadata?.perfectScore).toBe(false);
    });
  });
});
