/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { Logger } from "winston";
import { GradingAuditService } from "../../../services/question-response/grading-audit.service";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { LocalizationService } from "../../utils/localization.service";
import { UrlGradingStrategy } from "../url-grading.strategy";

describe("UrlGradingStrategy - Type Safety Tests", () => {
  let strategy: UrlGradingStrategy;
  let localizationService: jest.Mocked<LocalizationService>;
  let llmFacadeService: jest.Mocked<LlmFacadeService>;
  let gradingAuditService: jest.Mocked<GradingAuditService>;

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
        UrlGradingStrategy,
        {
          provide: LlmFacadeService,
          useValue: {
            gradeUrlBasedQuestion: jest.fn(),
          },
        },
        {
          provide: LocalizationService,
          useValue: {
            getLocalizedString: jest.fn((key: string) => {
              const messages: Record<string, string> = {
                expectedUrlResponse:
                  "Expected a URL response, but did not receive one.",
                invalidUrl: "Invalid URL",
              };
              return messages[key] || key;
            }),
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

    strategy = module.get<UrlGradingStrategy>(UrlGradingStrategy);
    localizationService = module.get(LocalizationService);
    llmFacadeService = module.get(LlmFacadeService);
    gradingAuditService = module.get(GRADING_AUDIT_SERVICE);
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Test question",
      type: "URL" as any,
      totalPoints: 10,
    } as QuestionDto;

    it("should handle null learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle undefined learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: undefined,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle number as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: 12_345,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle object as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: { url: "https://example.com" },
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle array as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: ["https://example.com"],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle boolean as learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: true,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle empty string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should handle whitespace-only string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "   ",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow(BadRequestException);
    });

    it("should accept valid URL string", async () => {
      const requestDto = {
        learnerUrlResponse: "https://example.com",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("accepts a non-empty response and defers URL validity to grading time", async () => {
      // Format validity is no longer a hard validation gate: an unparseable
      // URL must be graded 0-with-feedback in gradeResponse, not thrown here
      // (a throw fails the whole grading job and leaves the attempt ungraded).
      const requestDto = {
        learnerUrlResponse: "not a valid url",
        language: "en",
      } as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).resolves.toBe(true);
    });
  });

  describe("gradeResponse - invalid URL handling", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Submit your project URL",
      type: "URL" as any,
      totalPoints: 10,
    } as QuestionDto;

    const context = {
      language: "en",
      assignmentId: 1,
      questionAnswerContext: "",
      assignmentInstructions: "",
    } as any;

    it("grades an unparseable URL as 0 with feedback instead of throwing or fetching", async () => {
      const result = await strategy.gradeResponse(
        mockQuestion,
        "script.js",
        context,
      );

      expect(result.totalPoints).toBe(0);
      expect(JSON.stringify(result)).toMatch(/invalid url/i);
      // Must short-circuit before any LLM grading call.
      expect(llmFacadeService.gradeUrlBasedQuestion).not.toHaveBeenCalled();
    });
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should throw error for null learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for undefined learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for number learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: 123,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw error for object learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: { url: "test" },
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should trim valid string learnerUrlResponse", async () => {
      const requestDto = {
        learnerUrlResponse: "  https://example.com  ",
      } as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBe("https://example.com");
    });
  });
});
