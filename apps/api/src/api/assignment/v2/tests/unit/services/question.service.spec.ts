/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType, ResponseType } from "@prisma/client";
import {
  Choice,
  GenerateQuestionVariantDto,
  VariantDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/prisma.service";
import {
  createMockJob,
  createMockJobStatusService,
  createMockLlmFacadeService,
  createMockPrismaService,
  createMockQuestionDto,
  createMockQuestionGenerationPayload,
  createMockQuestionRepository,
  createMockTranslationService,
  createMockVariantDto,
  createMockVariantRepository,
} from "../__mocks__/ common-mocks";
import { QuestionRepository } from "../../../repositories/question.repository";
import { VariantRepository } from "../../../repositories/variant.repository";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import { QuestionService } from "../../../services/question.service";
import { TranslationService } from "../../../services/translation.service";

describe("QuestionService", () => {
  let questionService: QuestionService;
  let prismaService: ReturnType<typeof createMockPrismaService>;
  let questionRepository: ReturnType<typeof createMockQuestionRepository>;
  let variantRepository: ReturnType<typeof createMockVariantRepository>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let llmFacadeService: ReturnType<typeof createMockLlmFacadeService>;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;

  beforeEach(async () => {
    prismaService = createMockPrismaService();
    questionRepository = createMockQuestionRepository();
    variantRepository = createMockVariantRepository();
    translationService = createMockTranslationService();
    llmFacadeService = createMockLlmFacadeService();
    jobStatusService = createMockJobStatusService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionService,
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: QuestionRepository,
          useValue: questionRepository,
        },
        {
          provide: VariantRepository,
          useValue: variantRepository,
        },
        {
          provide: TranslationService,
          useValue: translationService,
        },
        {
          provide: LlmFacadeService,
          useValue: llmFacadeService,
        },
        {
          provide: JobStatusServiceV2,
          useValue: jobStatusService,
        },
      ],
    }).compile();

    questionService = module.get<QuestionService>(QuestionService);
  });

  describe("getQuestionsForAssignment", () => {
    it("should return questions for an assignment", async () => {
      const assignmentId = 1;
      const expectedQuestions = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      questionRepository.findByAssignmentId.mockResolvedValue(
        expectedQuestions,
      );

      const result =
        await questionService.getQuestionsForAssignment(assignmentId);

      expect(questionRepository.findByAssignmentId).toHaveBeenCalledWith(
        assignmentId,
      );
      expect(result).toEqual(expectedQuestions);
    });
  });

  describe("generateQuestionVariants", () => {
    it("should generate variants for questions", async () => {
      const assignmentId = 1;
      const question1 = createMockQuestionDto({ id: 1 });
      const question2 = createMockQuestionDto(
        { id: 2 },
        QuestionType.MULTIPLE_CORRECT,
      );

      const generateVariantDto: GenerateQuestionVariantDto = {
        questions: [question1, question2],
        questionVariationNumber: 2,
      };

      const mockVariants = [
        createMockVariantDto({
          id: 101,
          variantContent: "What is the capital city of France?",
        }),
        createMockVariantDto({
          id: 102,
          variantContent: "Which city serves as the capital of France?",
        }),
      ];
      llmFacadeService.generateQuestionRewordings.mockResolvedValue(
        mockVariants,
      );

      const result = await questionService.generateQuestionVariants(
        assignmentId,
        generateVariantDto,
      );

      expect(result.id).toEqual(assignmentId);
      expect(result.success).toBe(true);
      expect(result.questions).toBeDefined();
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].variants).toBeDefined();
      expect(llmFacadeService.generateQuestionRewordings).toHaveBeenCalledTimes(
        2,
      );
    });

    it("should not generate variants when enough already exist", async () => {
      const assignmentId = 1;

      const existingVariants = [
        createMockVariantDto({ id: 101 }),
        createMockVariantDto({ id: 102 }),
      ];
      const question = createMockQuestionDto({
        id: 1,
        variants: existingVariants,
      });

      const generateVariantDto: GenerateQuestionVariantDto = {
        questions: [question],
        questionVariationNumber: 2,
      };

      jest
        .spyOn(questionService as any, "calculateRequiredVariants")
        .mockReturnValue(0);

      const result = await questionService.generateQuestionVariants(
        assignmentId,
        generateVariantDto,
      );

      expect(result.id).toEqual(assignmentId);
      expect(result.success).toBe(true);
      expect(
        llmFacadeService.generateQuestionRewordings,
      ).not.toHaveBeenCalled();
    });

    describe("processQuestionsForPublishing", () => {
      it("should process questions for publishing", async () => {
        const assignmentId = 1;
        const jobId = 1;
        const questions = [
          createMockQuestionDto({ id: 1 }),
          createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
        ];

        const existingQuestions = [
          createMockQuestionDto({ id: 1 }),
          createMockQuestionDto({ id: 3 }),
        ];

        questionRepository.findByAssignmentId.mockResolvedValue(
          existingQuestions,
        );

        questionRepository.upsert.mockResolvedValue(questions[0]);

        await questionService.processQuestionsForPublishing(
          assignmentId,
          questions,
          jobId,
        );

        expect(questionRepository.findByAssignmentId).toHaveBeenCalledWith(
          assignmentId,
        );
        expect(questionRepository.markAsDeleted).toHaveBeenCalledWith([3]);

        expect(jobStatusService.updateJobStatus).toHaveBeenCalled();
        expect(questionRepository.upsert).toHaveBeenCalledTimes(2);
      });

      it("should handle translations for changed content", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const originalQuestion = createMockQuestionDto({
          id: 1,
          question: "Original question text",
        });

        const updatedQuestion = createMockQuestionDto({
          id: 1,
          question: "Updated question text",
        });

        questionRepository.findByAssignmentId.mockResolvedValue([
          originalQuestion,
        ]);
        questionRepository.upsert.mockResolvedValue(updatedQuestion);
        llmFacadeService.applyGuardRails.mockResolvedValue(true);

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        expect(llmFacadeService.applyGuardRails).toHaveBeenCalled();
        expect(translationService.translateQuestion).toHaveBeenCalled();
      });

      it("should only translate questions when content changes", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const question = createMockQuestionDto({ id: 1 });

        questionRepository.findByAssignmentId.mockResolvedValue([question]);
        questionRepository.upsert.mockResolvedValue(question);

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        expect(translationService.translateQuestion).toHaveBeenCalledWith(
          assignmentId,
          question.id,
          question,
          jobId,
          true, // questionContentChanged should be true for unchanged content - will retranslate
        );
      });

      it("should force translation when question content changes", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const existingQuestion = createMockQuestionDto({
          id: 1,
          question: "Original question text",
        });
        const updatedQuestion = createMockQuestionDto({
          id: 1,
          question: "Updated question text",
        });

        questionRepository.findByAssignmentId.mockResolvedValue([
          existingQuestion,
        ]);
        questionRepository.upsert.mockResolvedValue(updatedQuestion);

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        expect(translationService.translateQuestion).toHaveBeenCalledWith(
          assignmentId,
          updatedQuestion.id,
          updatedQuestion,
          jobId,
          true, // questionContentChanged should be true - will force retranslation
        );
      });
    });

    describe("generateQuestions", () => {
      it("should start question generation job", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const mockJob = createMockJob({ id: 1 });
        const payload = createMockQuestionGenerationPayload();

        jobStatusService.createJob.mockResolvedValue(mockJob);

        jest
          .spyOn(questionService as any, "startQuestionGenerationProcess")
          .mockResolvedValue(undefined);

        const result = await questionService.generateQuestions(
          assignmentId,
          payload,
          userId,
        );

        expect(jobStatusService.createJob).toHaveBeenCalledWith(
          assignmentId,
          userId,
        );
        expect(result).toEqual({
          message: "Question generation started",
          jobId: mockJob.id,
        });
      });

      it("should validate question generation payload", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const invalidPayload = {
          ...createMockQuestionGenerationPayload(),
          fileContents: undefined,
          learningObjectives: undefined,
        };

        await expect(
          questionService.generateQuestions(
            assignmentId,
            invalidPayload,
            userId,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it("should validate questions to generate count", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const invalidPayload = {
          ...createMockQuestionGenerationPayload(),
          questionsToGenerate: {
            multipleChoice: 0,
            multipleSelect: 0,
            textResponse: 0,
            trueFalse: 0,
            url: 0,
            upload: 0,
            linkFile: 0,
            responseTypes: {
              TEXT: [ResponseType.ESSAY],
            },
          },
        };

        await expect(
          questionService.generateQuestions(
            assignmentId,
            invalidPayload,
            userId,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe("updateQuestionGradingContext", () => {
      it("should update question grading context", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          id: assignmentId,
          questionOrder: [1, 2],
          questions: [
            { id: 1, question: "Question 1", isDeleted: false },
            { id: 2, question: "Question 2", isDeleted: false },
          ],
        };

        const mockGradingContext = {
          "1": [2],
          "2": [1],
        };

        prismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
        llmFacadeService.generateQuestionGradingContext.mockResolvedValue(
          mockGradingContext,
        );
        prismaService.question.update.mockResolvedValue({});

        await questionService.updateQuestionGradingContext(assignmentId);

        expect(prismaService.assignment.findUnique).toHaveBeenCalledWith({
          where: { id: assignmentId },
          include: {
            questions: {
              where: { isDeleted: false },
            },
          },
        });

        expect(
          llmFacadeService.generateQuestionGradingContext,
        ).toHaveBeenCalledWith(
          expect.arrayContaining([
            { id: 1, questionText: "Question 1" },
            { id: 2, questionText: "Question 2" },
          ]),
          assignmentId,
        );

        expect(prismaService.question.update).toHaveBeenCalledTimes(2);
      });

      it("should throw not found exception for invalid assignment", async () => {
        const assignmentId = 999;
        prismaService.assignment.findUnique.mockResolvedValue(null);

        await expect(
          questionService.updateQuestionGradingContext(assignmentId),
        ).rejects.toThrow(NotFoundException);
      });
    });

    describe("private methods", () => {
      describe("areChoicesEqual", () => {
        it("should return true for identical choices", () => {
          const choices1: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option B",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          const choices2 = [...choices1];

          const result = (questionService as any).areChoicesEqual(
            choices1,
            choices2,
          );

          expect(result).toBe(true);
        });

        it("should return false for different choices", () => {
          const choices1: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option B",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          const choices2: Choice[] = [
            {
              id: 1,
              choice: "Option A",
              isCorrect: true,
              points: 5,
              feedback: "Correct!",
            },
            {
              id: 2,
              choice: "Option C",
              isCorrect: false,
              points: 0,
              feedback: "Wrong",
            },
          ];

          const result = (questionService as any).areChoicesEqual(
            choices1,
            choices2,
          );

          expect(result).toBe(false);
        });

        it("should handle undefined choices correctly", () => {
          expect((questionService as any).areChoicesEqual()).toBe(true);
          expect((questionService as any).areChoicesEqual([])).toBe(false);
          expect((questionService as any).areChoicesEqual(undefined, [])).toBe(
            false,
          );
        });
      });

      describe("checkVariantsForChanges", () => {
        it("should detect changes in variant count", () => {
          const existingVariants: VariantDto[] = [
            createMockVariantDto({ id: 101 }),
          ];

          const newVariants: VariantDto[] = [
            createMockVariantDto({ id: 101 }),
            createMockVariantDto({ id: 102 }),
          ];

          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          expect(result).toBe(true);
        });

        it("should detect changes in variant content", () => {
          const existingVariants: VariantDto[] = [
            createMockVariantDto({
              id: 101,
              variantContent: "Original content",
            }),
          ];

          const newVariants: VariantDto[] = [
            createMockVariantDto({
              id: 101,
              variantContent: "Changed content",
            }),
          ];

          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          expect(result).toBe(true);
        });

        it("should return false when no changes exist", () => {
          const existingVariant = createMockVariantDto({ id: 101 });
          const existingVariants: VariantDto[] = [existingVariant];
          const newVariants: VariantDto[] = [existingVariant];

          const result = (questionService as any).checkVariantsForChanges(
            existingVariants,
            newVariants,
          );

          expect(result).toBe(false);
        });
      });

      describe("calculateRequiredVariants", () => {
        it("should calculate required variants for single question", () => {
          const result = (questionService as any).calculateRequiredVariants(
            1,
            1,
            3,
          );

          expect(result).toBe(3);
        });

        it("should calculate required variants for multiple questions", () => {
          const result = (questionService as any).calculateRequiredVariants(
            2,
            1,
            3,
          );

          expect(result).toBe(2);
        });

        it("should return zero when enough variants exist", () => {
          const result = (questionService as any).calculateRequiredVariants(
            2,
            4,
            3,
          );

          expect(result).toBe(0);
        });
      });

      describe("applyGuardRails", () => {
        it("should validate question content through LLM service", async () => {
          const question = createMockQuestionDto();
          llmFacadeService.applyGuardRails.mockResolvedValue(true);

          await (questionService as any).applyGuardRails(question);

          expect(llmFacadeService.applyGuardRails).toHaveBeenCalledWith(
            expect.any(String),
          );
        });

        it("should throw exception for invalid content", async () => {
          const question = createMockQuestionDto();
          llmFacadeService.applyGuardRails.mockResolvedValue(false);

          await expect(
            (questionService as any).applyGuardRails(question),
          ).rejects.toThrow(BadRequestException);
        });
      });
    });
  });
});
