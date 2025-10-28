/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { GRADING_JUDGE_SERVICE } from "src/api/llm/llm.constants";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { LocalizationService } from "../../utils/localization.service";
import { TextGradingStrategy } from "../text-grading.strategy";

describe("TextGradingStrategy - Type Safety Tests", () => {
  let strategy: TextGradingStrategy;

  beforeEach(async () => {
    const mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as Logger;

    const mockLlmFacadeService = {
      generateText: jest.fn(),
      chat: jest.fn(),
    };

    const mockGradingJudgeService = {
      judgeResponse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TextGradingStrategy,
        {
          provide: LlmFacadeService,
          useValue: mockLlmFacadeService,
        },
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
          provide: GRADING_JUDGE_SERVICE,
          useValue: mockGradingJudgeService,
        },
        {
          provide: "winston",
          useValue: mockLogger,
        },
      ],
    }).compile();

    strategy = module.get<TextGradingStrategy>(TextGradingStrategy);
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should handle null learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should handle undefined learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should handle number as learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: 12_345,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should handle object as learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: { text: "some answer" },
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should handle array as learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: ["answer1", "answer2"],
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should handle boolean as learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: true,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Text response must be a string",
      );
    });

    it("should accept valid string learnerTextResponse", async () => {
      const requestDto = {
        learnerTextResponse: "This is a valid text response",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("This is a valid text response");
    });

    it("should trim whitespace from valid string", async () => {
      const requestDto = {
        learnerTextResponse: "  trimmed text  ",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("trimmed text");
    });

    it("should handle empty string", async () => {
      const requestDto = {
        learnerTextResponse: "",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("");
    });

    it("should handle whitespace-only string", async () => {
      const requestDto = {
        learnerTextResponse: "   ",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("");
    });
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "What is your answer?",
      type: "TEXT" as any,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
    } as any;

    it("should reject null textResponse", async () => {
      const requestDto = {
        learnerTextResponse: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject undefined textResponse", async () => {
      const requestDto = {
        learnerTextResponse: undefined,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject number textResponse", async () => {
      const requestDto = {
        learnerTextResponse: 42,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject empty string textResponse", async () => {
      const requestDto = {
        learnerTextResponse: "",
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject whitespace-only textResponse", async () => {
      const requestDto = {
        learnerTextResponse: "   ",
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should accept valid non-empty string", async () => {
      const requestDto = {
        learnerTextResponse: "This is a valid answer",
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should trim and accept string with whitespace", async () => {
      const requestDto = {
        learnerTextResponse: "  valid answer  ",
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });
  });
});
