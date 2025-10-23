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
  });
});
