/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { GradingContext } from "../../interfaces/grading-context.interface";
import { LocalizationService } from "../../utils/localization.service";
import { ChoiceGradingStrategy } from "../choice-grading.strategy";

describe("ChoiceGradingStrategy - Type Safety Tests", () => {
  let strategy: ChoiceGradingStrategy;

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
        ChoiceGradingStrategy,
        {
          provide: LocalizationService,
          useValue: {
            getLocalizedString: jest.fn((key: string) => key),
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

    strategy = module.get<ChoiceGradingStrategy>(ChoiceGradingStrategy);
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should handle null learnerChoices", async () => {
      const requestDto = {
        learnerChoices: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual([]);
    });

    it("should handle undefined learnerChoices", async () => {
      const requestDto = {
        learnerChoices: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual([]);
    });

    it("should accept valid string array", async () => {
      const requestDto = {
        learnerChoices: ["choice1", "choice2"],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["choice1", "choice2"]);
    });

    it("should accept empty array", async () => {
      const requestDto = {
        learnerChoices: [],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual([]);
    });

    it("should accept single choice as array", async () => {
      const requestDto = {
        learnerChoices: ["single-choice"],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["single-choice"]);
    });

    it("should convert numeric learner choices to strings", async () => {
      const requestDto = {
        learnerChoices: [1, 2, 3],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["1", "2", "3"]);
    });

    it("should extract text from object based learner choices", async () => {
      const requestDto = {
        learnerChoices: [
          { value: "Option A" },
          { label: "Option B" },
          { choice: { text: "Option C" } },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["Option A", "Option B", "Option C"]);
    });

    it("should convert float learner choices to strings", async () => {
      const requestDto = {
        learnerChoices: [3.14159, 2.71828, 0.5],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["3.14159", "2.71828", "0.5"]);
    });

    it("should preserve decimal points in float choices during extraction", async () => {
      const requestDto = {
        learnerChoices: [1.5, 10.25, 100.999],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(["1.5", "10.25", "100.999"]);
    });
  });

  describe("validateResponse - Single Choice", () => {
    const mockSingleChoiceQuestion: QuestionDto = {
      id: 1,
      question: "Choose one option",
      type: QuestionType.SINGLE_CORRECT,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
      choices: [
        { id: 1, choice: "Option A", isCorrect: true, points: 10 },
        { id: 2, choice: "Option B", isCorrect: false, points: 0 },
      ],
    } as any;

    it("should reject multiple choices for single-choice question", async () => {
      const requestDto = {
        learnerChoices: ["choice1", "choice2"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockSingleChoiceQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should accept single choice for single-choice question", async () => {
      const requestDto = {
        learnerChoices: ["choice1"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockSingleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });

    it("should accept empty array for single-choice question", async () => {
      const requestDto = {
        learnerChoices: [],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockSingleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });

    it("should accept null choices for single-choice question", async () => {
      const requestDto = {
        learnerChoices: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockSingleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });
  });

  describe("validateResponse - Multiple Choice", () => {
    const mockMultipleChoiceQuestion: QuestionDto = {
      id: 1,
      question: "Choose multiple options",
      type: QuestionType.MULTIPLE_CORRECT,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
      choices: [
        { id: 1, choice: "Option A", isCorrect: true, points: 5 },
        { id: 2, choice: "Option B", isCorrect: true, points: 5 },
        { id: 3, choice: "Option C", isCorrect: false, points: 0 },
      ],
    } as any;

    it("should accept multiple choices for multiple-choice question", async () => {
      const requestDto = {
        learnerChoices: ["choice1", "choice2"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockMultipleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });

    it("should accept single choice for multiple-choice question", async () => {
      const requestDto = {
        learnerChoices: ["choice1"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockMultipleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });

    it("should accept empty array for multiple-choice question", async () => {
      const requestDto = {
        learnerChoices: [],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(
        mockMultipleChoiceQuestion,
        requestDto,
      );
      expect(result).toBe(true);
    });
  });

  describe("gradeResponse - Type Safety", () => {
    const mockContext: GradingContext = {
      assignmentInstructions: "",
      questionAnswerContext: [],
      assignmentId: 1,
      language: "en",
      userRole: "learner" as any,
      metadata: {},
    };

    const mockSingleChoiceQuestion: QuestionDto = {
      id: 1,
      question: "Choose one",
      type: QuestionType.SINGLE_CORRECT,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
      choices: [
        { id: 1, choice: "Correct", isCorrect: true, points: 10 },
        { id: 2, choice: "Wrong", isCorrect: false, points: 0 },
      ],
    } as any;

    it("should handle empty learner response", async () => {
      const result = await strategy.gradeResponse(
        mockSingleChoiceQuestion,
        [],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should handle null-like learner response", async () => {
      const result = await strategy.gradeResponse(
        mockSingleChoiceQuestion,
        null as any,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should handle single valid choice", async () => {
      const result = await strategy.gradeResponse(
        mockSingleChoiceQuestion,
        ["1"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should gracefully handle numeric learner choices during grading", async () => {
      const { responseDto, learnerResponse } = await strategy.handleResponse(
        mockSingleChoiceQuestion,
        {
          learnerChoices: [123 as any],
          language: "en",
        } as CreateQuestionResponseAttemptRequestDto,
        mockContext,
      );

      expect(learnerResponse).toEqual(["123"]);
      expect(responseDto).toBeDefined();
      expect(responseDto.totalPoints).toBe(0);
    });

    it("should handle multiple choice question with multiple responses", async () => {
      const mockMultipleChoiceQuestion: QuestionDto = {
        id: 1,
        question: "Choose multiple",
        type: QuestionType.MULTIPLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "Correct 1", isCorrect: true, points: 5 },
          { id: 2, choice: "Correct 2", isCorrect: true, points: 5 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockMultipleChoiceQuestion,
        ["1", "2"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBeDefined();
    });

    it("should correctly grade single choice question with float choice values", async () => {
      const mockFloatChoiceQuestion: QuestionDto = {
        id: 1,
        question: "Select the value of pi",
        type: QuestionType.SINGLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "3.14159", isCorrect: true, points: 10 },
          { id: 2, choice: "2.71828", isCorrect: false, points: 0 },
          { id: 3, choice: "1.41421", isCorrect: false, points: 0 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockFloatChoiceQuestion,
        ["3.14159"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBe(10);
    });

    it("should correctly grade multiple choice question with float choice values", async () => {
      const mockFloatMultipleChoiceQuestion: QuestionDto = {
        id: 1,
        question: "Select irrational numbers",
        type: QuestionType.MULTIPLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "3.14159", isCorrect: true, points: 5 },
          { id: 2, choice: "2.71828", isCorrect: true, points: 5 },
          { id: 3, choice: "0.5", isCorrect: false, points: 0 },
          { id: 4, choice: "1.414213562", isCorrect: true, points: 3 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockFloatMultipleChoiceQuestion,
        ["3.14159", "2.71828"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBe(10);
    });

    it("should distinguish between similar float values", async () => {
      const mockSimilarFloatQuestion: QuestionDto = {
        id: 1,
        question: "Select the correct value",
        type: QuestionType.SINGLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "3.14", isCorrect: false, points: 0 },
          { id: 2, choice: "3.141", isCorrect: false, points: 0 },
          { id: 3, choice: "3.1415", isCorrect: true, points: 10 },
          { id: 4, choice: "314", isCorrect: false, points: 0 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockSimilarFloatQuestion,
        ["3.1415"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBe(10);
    });

    it("should not confuse float '3.14' with integer '314'", async () => {
      const mockFloatVsIntegerQuestion: QuestionDto = {
        id: 1,
        question: "Which is pi (approximately)?",
        type: QuestionType.SINGLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "3.14", isCorrect: true, points: 10 },
          { id: 2, choice: "314", isCorrect: false, points: 0 },
        ],
      } as any;

      const result1 = await strategy.gradeResponse(
        mockFloatVsIntegerQuestion,
        ["3.14"],
        mockContext,
      );
      expect(result1.totalPoints).toBe(10);

      const result2 = await strategy.gradeResponse(
        mockFloatVsIntegerQuestion,
        ["314"],
        mockContext,
      );
      expect(result2.totalPoints).toBe(0);
    });

    it("should handle float choices with fractional points", async () => {
      const mockFloatPointsQuestion: QuestionDto = {
        id: 1,
        question: "Select correct answers",
        type: QuestionType.MULTIPLE_CORRECT,
        totalPoints: 10,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "0.5", isCorrect: true, points: 2.5 },
          { id: 2, choice: "1.5", isCorrect: true, points: 3.5 },
          { id: 3, choice: "2.5", isCorrect: true, points: 4 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockFloatPointsQuestion,
        ["0.5", "1.5"],
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.totalPoints).toBe(6);
    });

    it("caps the score at the question's totalPoints when the correct choices sum to more", async () => {
      // A multi-select worth 1 point, but with two correct choices each
      // carrying 1 point. Selecting both must not award 2 — the question's
      // own maximum (totalPoints) is authoritative, otherwise a single
      // question can exceed 100% and mask other questions' losses.
      const mockOverCappedQuestion: QuestionDto = {
        id: 1,
        question: "Select all that apply",
        type: QuestionType.MULTIPLE_CORRECT,
        totalPoints: 1,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "Correct A", isCorrect: true, points: 1 },
          { id: 2, choice: "Correct B", isCorrect: true, points: 1 },
          { id: 3, choice: "Wrong", isCorrect: false, points: 0 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockOverCappedQuestion,
        ["Correct A", "Correct B"],
        mockContext,
      );

      expect(result.totalPoints).toBe(1);
    });

    it("falls back to the correct-choice sum when the question has no usable totalPoints", async () => {
      // MULTIPLE_CORRECT questions are not required to carry totalPoints,
      // so when it is absent the correct-choice sum remains the ceiling.
      const mockNoTotalPointsQuestion: QuestionDto = {
        id: 1,
        question: "Select all that apply",
        type: QuestionType.MULTIPLE_CORRECT,
        assignmentId: 1,
        gradingContextQuestionIds: [],
        choices: [
          { id: 1, choice: "Correct A", isCorrect: true, points: 2 },
          { id: 2, choice: "Correct B", isCorrect: true, points: 3 },
        ],
      } as any;

      const result = await strategy.gradeResponse(
        mockNoTotalPointsQuestion,
        ["Correct A", "Correct B"],
        mockContext,
      );

      expect(result.totalPoints).toBe(5);
    });
  });
});
