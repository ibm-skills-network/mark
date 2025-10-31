/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from "@nestjs/testing";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { GRADING_JUDGE_SERVICE } from "src/api/llm/llm.constants";
import { Logger } from "winston";
import {
  FILE_CONTENT_EXTRACTION_SERVICE,
  GRADING_AUDIT_SERVICE,
} from "../../../attempt.constants";
import { LocalizationService } from "../../utils/localization.service";
import { FileGradingStrategy } from "../file-grading.strategy";

describe("FileGradingStrategy - Type Safety Tests", () => {
  let strategy: FileGradingStrategy;

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

    const mockFileContentExtractionService = {
      extractContentFromFiles: jest.fn().mockResolvedValue([]),
    };

    const mockGradingJudgeService = {
      judgeResponse: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileGradingStrategy,
        {
          provide: LlmFacadeService,
          useValue: mockLlmFacadeService,
        },
        {
          provide: FILE_CONTENT_EXTRACTION_SERVICE,
          useValue: mockFileContentExtractionService,
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

    strategy = module.get<FileGradingStrategy>(FileGradingStrategy);
  });

  describe("validateResponse - Type Safety", () => {
    const mockQuestion: QuestionDto = {
      id: 1,
      question: "Upload a file",
      type: "FILE" as any,
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

    it("should reject file without required storage metadata", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.pdf",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow("Invalid file metadata");
    });

    it("should reject file without filename", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            key: "some-key",
            bucket: "some-bucket",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      await expect(
        strategy.validateResponse(mockQuestion, requestDto),
      ).rejects.toThrow("Invalid file metadata");
    });

    it("should accept valid file with storage metadata", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test.pdf",
            key: "some-key",
            bucket: "some-bucket",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept valid file with GitHub metadata", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "README.md",
            githubUrl: "https://github.com/user/repo/blob/main/README.md",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept multiple valid files", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "test1.pdf",
            key: "key1",
            bucket: "bucket1",
          },
          {
            filename: "test2.pdf",
            key: "key2",
            bucket: "bucket2",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });

    it("should accept mix of storage and GitHub files", async () => {
      const requestDto = {
        learnerFileResponse: [
          {
            filename: "local.pdf",
            key: "some-key",
            bucket: "some-bucket",
          },
          {
            filename: "remote.md",
            githubUrl: "https://github.com/user/repo/blob/main/file.md",
          },
        ],
        language: "en",
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.validateResponse(mockQuestion, requestDto);
      expect(result).toBe(true);
    });
  });

  describe("extractLearnerResponse - Type Safety", () => {
    it("should handle null learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: null,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBeNull();
    });

    it("should handle undefined learnerFileResponse", async () => {
      const requestDto = {
        learnerFileResponse: undefined,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toBeUndefined();
    });

    it("should return empty array as-is", async () => {
      const requestDto = {
        learnerFileResponse: [],
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual([]);
    });

    it("should extract valid file uploads", async () => {
      const files = [
        {
          filename: "test.pdf",
          key: "some-key",
          bucket: "some-bucket",
        },
      ];

      const requestDto = {
        learnerFileResponse: files,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(files);
    });

    it("should extract multiple files", async () => {
      const files = [
        {
          filename: "test1.pdf",
          key: "key1",
          bucket: "bucket1",
        },
        {
          filename: "test2.pdf",
          key: "key2",
          bucket: "bucket2",
        },
      ];

      const requestDto = {
        learnerFileResponse: files,
      } as any as CreateQuestionResponseAttemptRequestDto;

      const result = await strategy.extractLearnerResponse(requestDto);
      expect(result).toEqual(files);
    });
  });
});
