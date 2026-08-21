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

  describe("gradeResponse - correct answer comes from isCorrect, not position", () => {
    const mockContext: GradingContext = {
      assignmentInstructions: "",
      questionAnswerContext: [],
      assignmentId: 1,
      language: "en",
      userRole: "learner" as any,
      metadata: {},
    };

    // The shape every authored TF question actually has: [True, False],
    // with isCorrect flagging the answer and points sitting on that row.
    const tfQuestion = (correct: "True" | "False"): QuestionDto =>
      ({
        id: 9876,
        question: "You can change the value of an element in a tuple.",
        type: "TRUE_FALSE" as any,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          {
            id: 0,
            choice: "True",
            isCorrect: correct === "True",
            points: correct === "True" ? 1 : 0,
          },
          {
            id: 1,
            choice: "False",
            isCorrect: correct === "False",
            points: correct === "False" ? 1 : 0,
          },
        ],
      }) as any;

    it("accepts False on a False-answer question", async () => {
      // The regression this guards: choices[0] is the True row, so
      // position-keyed grading marked every correct False answer wrong.
      const result = await strategy.gradeResponse(
        tfQuestion("False"),
        false,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
      expect((result.metadata as any).isCorrect).toBe(true);
      expect((result.metadata as any).correctAnswer).toBe(false);
    });

    it("rejects True on a False-answer question", async () => {
      const result = await strategy.gradeResponse(
        tfQuestion("False"),
        true,
        mockContext,
      );

      expect(result.totalPoints).toBe(0);
      expect((result.feedback as any)[0].feedback).toContain("False");
    });

    it("accepts True on a True-answer question", async () => {
      const result = await strategy.gradeResponse(
        tfQuestion("True"),
        true,
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("rejects False on a True-answer question", async () => {
      const result = await strategy.gradeResponse(
        tfQuestion("True"),
        false,
        mockContext,
      );

      expect(result.totalPoints).toBe(0);
      expect((result.feedback as any)[0].feedback).toContain("True");
    });

    it("awards the correct choice's points when the question has no totalPoints", async () => {
      const question = tfQuestion("False");
      (question as any).totalPoints = undefined;
      (question as any).choices[1].points = 2;

      const result = await strategy.gradeResponse(question, false, mockContext);

      // The True row carries 0 points on a False-answer question; reading
      // choices[0].points here silently awarded 0 for a correct answer.
      expect(result.totalPoints).toBe(2);
    });

    it("refuses to grade when the question has no choices", async () => {
      const question = tfQuestion("True");
      (question as any).choices = [];

      await expect(
        strategy.gradeResponse(question, true, mockContext),
      ).rejects.toThrow("Missing correct answer");
    });
  });
});
