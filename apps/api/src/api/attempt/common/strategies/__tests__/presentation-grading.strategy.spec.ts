/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { LocalizationService } from "../../utils/localization.service";
import { PresentationGradingStrategy } from "../presentation-grading.strategy";

describe("PresentationGradingStrategy - Type Safety Tests", () => {
  let strategy: PresentationGradingStrategy;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PresentationGradingStrategy,
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
          provide: "winston",
          useValue: mockLogger,
        },
      ],
    }).compile();

    strategy = module.get<PresentationGradingStrategy>(
      PresentationGradingStrategy,
    );
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Present your work",
      type: "PRESENTATION" as any,
      responseType: "PRESENTATION" as any,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
    } as any;

    it("should reject null learnerPresentationResponse", async () => {
      const requestDto = {
        learnerPresentationResponse: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject undefined learnerPresentationResponse", async () => {
      const requestDto = {
        learnerPresentationResponse: undefined,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should accept valid presentation response", async () => {
      const requestDto = {
        learnerPresentationResponse: {
          presentationUrl: "https://example.com/presentation.pdf",
          slideImages: [],
        },
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept presentation with slide images", async () => {
      const requestDto = {
        learnerPresentationResponse: {
          presentationUrl: "https://example.com/presentation.pdf",
          slideImages: [
            {
              slideNumber: 1,
              imageUrl: "https://example.com/slide1.png",
            },
          ],
        },
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept live recording response", async () => {
      const requestDto = {
        learnerPresentationResponse: {
          videoUrl: "https://example.com/recording.mp4",
          transcript: "This is my presentation...",
        },
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept empty object as presentation response", async () => {
      const requestDto = {
        learnerPresentationResponse: {},
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should handle null learnerPresentationResponse", async () => {
      const requestDto = {
        learnerPresentationResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBeNull();
    });

    it("should handle undefined learnerPresentationResponse", async () => {
      const requestDto = {
        learnerPresentationResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBeUndefined();
    });

    it("should extract valid presentation response", async () => {
      const presentationResponse = {
        presentationUrl: "https://example.com/presentation.pdf",
        slideImages: [
          {
            slideNumber: 1,
            imageUrl: "https://example.com/slide1.png",
          },
        ],
      };

      const requestDto = {
        learnerPresentationResponse: presentationResponse,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(presentationResponse);
    });

    it("should extract live recording response", async () => {
      const recordingResponse = {
        videoUrl: "https://example.com/recording.mp4",
        transcript: "Presentation transcript",
        duration: 300,
      };

      const requestDto = {
        learnerPresentationResponse: recordingResponse,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(recordingResponse);
    });

    it("should extract empty presentation response", async () => {
      const requestDto = {
        learnerPresentationResponse: {},
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual({});
    });

    it("should preserve all properties of presentation response", async () => {
      const presentationResponse = {
        presentationUrl: "https://example.com/presentation.pdf",
        slideImages: [
          {
            slideNumber: 1,
            imageUrl: "https://example.com/slide1.png",
            imageData: "base64data",
          },
          {
            slideNumber: 2,
            imageUrl: "https://example.com/slide2.png",
          },
        ],
        metadata: {
          totalSlides: 2,
          format: "PDF",
        },
      };

      const requestDto = {
        learnerPresentationResponse: presentationResponse,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(presentationResponse);
    });
  });
});
