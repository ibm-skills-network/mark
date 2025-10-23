/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { GradingContext } from "../../interfaces/grading-context.interface";
import { LocalizationService } from "../../utils/localization.service";
import { TrueFalseGradingStrategy } from "../true-false-grading.strategy";

describe("TrueFalseGradingStrategy - Type Safety Tests", () => {
  let strategy: TrueFalseGradingStrategy;

  beforeEach(async () => {
    const mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as Logger;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrueFalseGradingStrategy,
        {
          provide: LocalizationService,
          useValue: {
            getLocalizedString: jest.fn(
              (key: string, _language?: string, parameters?: any) => {
                const messages: Record<string, string> = {
                  correctTF: "Correct!",
                  incorrectTF: `Incorrect. The correct answer is ${String(
                    parameters?.correctAnswer || "true",
                  )}.`,
                  missingCorrectAnswer: "Missing correct answer",
                  true: "True",
                  false: "False",
                };
                return messages[key] || key;
              },
            ),
          },
        },
        {
          provide: GRADING_AUDIT_SERVICE,
          useValue: {
            recordGrading: jest.fn(),
          },
        },
        {
          provide: "winston",
          useValue: mockLogger,
        },
      ],
    }).compile();

    strategy = module.get<TrueFalseGradingStrategy>(TrueFalseGradingStrategy);
  });

  describe("gradeResponse - Choice Value Type Safety", () => {
    const mockContext: GradingContext = {
      assignmentInstructions: "",
      questionAnswerContext: [],
      assignmentId: 1,
      language: "en",
      userRole: "learner" as any,
      metadata: {},
    };

    it("should handle null choice value gracefully", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: null as any,
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should handle undefined choice value gracefully", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: undefined as any,
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should handle number as choice value", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: 1 as any,
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result).toBeDefined();
    });

    it("should handle object as choice value", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: { value: "true" } as any,
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result).toBeDefined();
    });

    it("should correctly parse true string as correct answer", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: "true",
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("should correctly parse false string as correct answer", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this false?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: "false",
            isCorrect: false,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        false,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("should handle mixed case choice values", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: "TRUE",
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("should handle choice with whitespace", async () => {
      const mockQuestion: QuestionDto = {
        id: 1,
        question: "Is this true?",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 1,
            choice: "  true  ",
            isCorrect: true,
            points: 1,
          },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockQuestion,
        true,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });
  });
});
