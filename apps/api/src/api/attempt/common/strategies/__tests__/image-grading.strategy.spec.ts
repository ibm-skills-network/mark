/* eslint-disable*/
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { ImageGradingService } from "src/api/llm/features/grading/services/image-grading.service";
import { UnsupportedImageFormatError } from "src/api/llm/features/grading/errors/unsupported-image-format.error";
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

  describe("SVG is no longer an accepted image format", () => {
    it("rejects an .svg filename during validation", () => {
      // isValidImageFormat is private; exercise it through validateResponse
      // path by asserting the format check directly.
      expect((strategy as any).isValidImageFormat("drawing.svg")).toBe(false);
    });

    it("does not map .svg to a MIME type", () => {
      // getMimeTypeFromFilename falls back to the jpeg default for unknown
      // extensions; svg must no longer be explicitly mapped to image/svg+xml.
      expect((strategy as any).getMimeTypeFromFilename("drawing.svg")).not.toBe(
        "image/svg+xml",
      );
    });

    it("still accepts and maps bmp and tiff (now convertible downstream)", () => {
      expect((strategy as any).isValidImageFormat("scan.bmp")).toBe(true);
      expect((strategy as any).isValidImageFormat("scan.tiff")).toBe(true);
      expect((strategy as any).getMimeTypeFromFilename("scan.bmp")).toBe(
        "image/bmp",
      );
      expect((strategy as any).getMimeTypeFromFilename("scan.tiff")).toBe(
        "image/tiff",
      );
    });
  });

  describe("validateResponse - base64 magic-byte sniffing", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Upload an image",
      type: "IMAGE" as any,
      totalPoints: 10,
      assignmentId: 1,
      gradingContextQuestionIds: [],
    } as any;

    // Helper: build an inline data URL from raw magic bytes so the strategy's
    // sniffer sees real signature bytes after the `;base64,` marker.
    const dataUrl = (mime: string, bytes: number[]): string =>
      `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

    const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    // ISO-BMFF box: 12-byte "ftypheic" prefix (size + "ftyp" + "heic" brand).
    const HEIC_PREFIX = [
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
    ];
    const TIFF_SIGNATURE = [0x49, 0x49, 0x2a, 0x00];

    it("accepts a base64 PNG data URL", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "diagram.png",
            imageData: dataUrl("image/png", PNG_SIGNATURE),
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).resolves.toBe(true);
    });

    it("rejects a base64 HEIC data URL with the typed learner-facing error", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "photo.png",
            imageData: dataUrl("image/png", HEIC_PREFIX),
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      // Must be the typed learner-facing error (not a BadRequestException) so
      // the grade-time path (validateResponse runs inside gradeQuestionNoSave)
      // fails terminally with the learner message instead of being wrapped and
      // retried. The learner-facing copy lives on `.learnerMessage`; `.message`
      // carries the operator detail (detected format + reason).
      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toBeInstanceOf(UnsupportedImageFormatError);
      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toMatchObject({
        learnerMessage: expect.stringMatching(/not a supported image format/i),
      });
    });

    it("accepts a base64 TIFF data URL (convertible downstream)", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "scan.tiff",
            imageData: dataUrl("image/tiff", TIFF_SIGNATURE),
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).resolves.toBe(true);
    });

    it("skips the byte check for an InCos placeholder (no inline base64)", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "stored.png",
            imageData: "InCos",
            imageKey: "cos/key",
            imageBucket: "bucket",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).resolves.toBe(true);
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
