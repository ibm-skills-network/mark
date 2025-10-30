/* eslint-disable*/
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { ImageGradingService } from "src/api/llm/features/grading/services/image-grading.service";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../../attempt.constants";
import { GradingContext } from "../../interfaces/grading-context.interface";
import { LocalizationService } from "../../utils/localization.service";
import { ImageGradingStrategy } from "../image-grading.strategy";

describe("ImageGradingStrategy - Type Safety Tests", () => {
  let strategy: ImageGradingStrategy;

  beforeEach(async () => {
    const mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as Logger;

    const mockImageGradingService = {
      gradeImageBasedQuestion: jest.fn(),
      analyzeImage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGradingStrategy,
        {
          provide: ImageGradingService,
          useValue: mockImageGradingService,
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

    strategy = module.get<ImageGradingStrategy>(ImageGradingStrategy);
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Upload an image",
      type: "IMAGE" as any,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
    } as any;

    it("should reject null learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: null,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject undefined learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: undefined,
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should reject empty learnerFileResponse array", async () => {
      const requestDto = {
        learnerFileResponse: [],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow();
    });

    it("should accept valid image response", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.jpg",
            imageData: "base64data",
            mimeType: "image/jpeg",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept multiple valid images", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test1.jpg",
            imageData: "base64data1",
            mimeType: "image/jpeg",
          },
          {
            filename: "test2.png",
            imageData: "base64data2",
            mimeType: "image/png",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should reject null learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "No images provided for grading",
      );
    });

    it("should reject undefined learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "No images provided for grading",
      );
    });

    it("should reject empty array", async () => {
      const requestDto = {
        learnerFileResponse: [],
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "No images provided for grading",
      );
    });

    it("should reject image without filename", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            imageData: "base64data",
            mimeType: "image/jpeg",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(strategy.extractLearnerResponse(requestDto)).rejects.toThrow(
        "Image filename is required",
      );
    });

    it("should extract valid single image", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.jpg",
            imageData: "base64data",
            imageUrl: "https://example.com/test.jpg",
            mimeType: "image/jpeg",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename: "test.jpg",
        imageData: "base64data",
        imageUrl: "https://example.com/test.jpg",
      });
    });

    it("should extract multiple valid images", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test1.jpg",
            imageData: "base64data1",
            mimeType: "image/jpeg",
          },
          {
            filename: "test2.png",
            imageData: "base64data2",
            mimeType: "image/png",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toHaveLength(2);
      expect(result[0].filename).toBe("test1.jpg");
      expect(result[1].filename).toBe("test2.png");
    });

    it("should handle legacy field names (content, key, bucket)", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.jpg",
            content: "base64data",
            key: "some-key",
            bucket: "some-bucket",
            fileType: "image/jpeg",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename: "test.jpg",
        imageData: "base64data",
        imageKey: "some-key",
        imageBucket: "some-bucket",
      });
    });

    it("should filter out 'InCos' placeholder imageData", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.jpg",
            imageData: "InCos",
            imageUrl: "https://example.com/test.jpg",
            mimeType: "image/jpeg",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toHaveLength(1);
      expect(result[0].imageData).toBe("");
    });

    it("should handle missing optional fields gracefully", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.jpg",
          },
        ],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        filename: "test.jpg",
        imageUrl: "",
        imageData: "",
      });
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

    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Upload an image",
      type: "IMAGE" as any,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
    } as any;

    it("should reject empty learner response", async () => {
      await expect(
        strategy.gradeResponse(mockQuestion, [], mockContext),
      ).rejects.toThrow("No valid images found for grading");
    });

    it("should reject null learner response", async () => {
      await expect(
        strategy.gradeResponse(mockQuestion, null as any, mockContext),
      ).rejects.toThrow("No valid images found for grading");
    });
  });
});
