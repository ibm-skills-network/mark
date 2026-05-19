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
import { PrismaService } from "src/database/prisma.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobQueueService } from "src/job-queue/job-queue.service";
import {
  createMockJob,
  createMockJobQueueService,
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
  let questionRepository: ReturnType<typeof createMockQuestionRepository> & {
    createForAssignment?: jest.Mock;
    updateOwnedById?: jest.Mock;
  };
  let variantRepository: ReturnType<typeof createMockVariantRepository>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let llmFacadeService: ReturnType<typeof createMockLlmFacadeService>;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;
  let jobQueueService: ReturnType<typeof createMockJobQueueService>;

  beforeEach(async () => {
    prismaService = createMockPrismaService();
    questionRepository = createMockQuestionRepository();
    variantRepository = createMockVariantRepository();
    translationService = createMockTranslationService();
    llmFacadeService = createMockLlmFacadeService();
    jobStatusService = createMockJobStatusService();
    jobQueueService = createMockJobQueueService();

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
        {
          provide: JobQueueService,
          useValue: jobQueueService,
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

        // First call returns the seeded existing questions; the post-flight
        // re-query returns the desired final state (count == incoming.length).
        questionRepository.findByAssignmentId
          .mockResolvedValueOnce(existingQuestions)
          .mockResolvedValueOnce(questions);

        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        questionRepository.createForAssignment = jest
          .fn()
          .mockResolvedValue({ id: 2, assignmentId });

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
        expect(questionRepository.updateOwnedById).toHaveBeenCalledTimes(1);
        expect(questionRepository.createForAssignment).toHaveBeenCalledTimes(1);
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

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([originalQuestion])
          .mockResolvedValueOnce([updatedQuestion]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        llmFacadeService.applyGuardRails.mockResolvedValue(true);

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        expect(llmFacadeService.applyGuardRails).toHaveBeenCalled();
        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_QUESTION,
          expect.objectContaining({
            parentJobId: 1,
            assignmentId: 1,
            questionId: updatedQuestion.id,
          }),
          expect.objectContaining({ attempts: 3 }),
        );
      });

      it("enqueues a translation job per question during publishing", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const question = createMockQuestionDto({ id: 1 });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([question])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_QUESTION,
          expect.objectContaining({
            parentJobId: jobId,
            assignmentId,
            questionId: question.id,
            question,
          }),
          expect.objectContaining({ attempts: 3 }),
        );
      });

      it("enqueues a translation job when question content changes", async () => {
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

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([existingQuestion])
          .mockResolvedValueOnce([updatedQuestion]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_QUESTION,
          expect.objectContaining({
            parentJobId: jobId,
            assignmentId,
            questionId: updatedQuestion.id,
            question: updatedQuestion,
          }),
          expect.objectContaining({ attempts: 3 }),
        );
      });

      it("enqueues TRANSLATE_QUESTION with forceRetranslation: false when question text and choices are unchanged", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const question = createMockQuestionDto({
          id: 1,
          question: "Same question text",
          alreadyInBackend: true,
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([question])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_QUESTION,
          expect.objectContaining({ forceRetranslation: false }),
          expect.anything(),
        );
      });

      it("enqueues TRANSLATE_QUESTION with forceRetranslation: true when question text changes", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const existingQuestion = createMockQuestionDto({
          id: 1,
          question: "Original text",
          alreadyInBackend: true,
        });
        const updatedQuestion = createMockQuestionDto({
          id: 1,
          question: "Changed text",
          alreadyInBackend: true,
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([existingQuestion])
          .mockResolvedValueOnce([updatedQuestion]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [updatedQuestion],
          jobId,
        );

        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_QUESTION,
          expect.objectContaining({ forceRetranslation: true }),
          expect.anything(),
        );
      });

      it("enqueues TRANSLATE_VARIANT with forceRetranslation: false when variant content is unchanged", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const variant = createMockVariantDto({
          id: 10,
          variantContent: "same content",
        });
        const question = createMockQuestionDto({
          id: 1,
          question: "Same question",
          alreadyInBackend: true,
          variants: [variant],
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([{ ...question, variants: [variant] }])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        variantRepository.update = jest
          .fn()
          .mockResolvedValue({ ...variant, questionId: 1 });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        const variantEnqueueCall = (
          jobQueueService.enqueue as jest.Mock
        ).mock.calls.find(
          (call: unknown[]) => call[1] === JOB_NAMES.TRANSLATE_VARIANT,
        );
        expect(variantEnqueueCall).toBeDefined();
        expect(variantEnqueueCall?.[2]).toMatchObject({
          forceRetranslation: false,
        });
      });

      it("enqueues TRANSLATE_VARIANT with forceRetranslation: true when variant content changes", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const existingVariant = createMockVariantDto({
          id: 10,
          variantContent: "old content",
        });
        const updatedVariant = createMockVariantDto({
          id: 10,
          variantContent: "new content",
        });
        const question = createMockQuestionDto({
          id: 1,
          question: "Same question",
          alreadyInBackend: true,
          variants: [updatedVariant],
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([{ ...question, variants: [existingVariant] }])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        variantRepository.update = jest
          .fn()
          .mockResolvedValue({ ...updatedVariant, questionId: 1 });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        const variantEnqueueCall = (
          jobQueueService.enqueue as jest.Mock
        ).mock.calls.find(
          (call: unknown[]) => call[1] === JOB_NAMES.TRANSLATE_VARIANT,
        );
        expect(variantEnqueueCall).toBeDefined();
        expect(variantEnqueueCall?.[2]).toMatchObject({
          forceRetranslation: true,
        });
      });

      it("seeds in-flight counter once before each TRANSLATE_QUESTION enqueue", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const question = createMockQuestionDto({
          id: 1,
          question: "Q",
          alreadyInBackend: true,
        });
        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([question])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        // seedOneInflightJob called once, then enqueue called once — ordering guaranteed
        // by sequential await in the production code
        expect(translationService.seedOneInflightJob).toHaveBeenCalledWith(
          assignmentId,
        );
        expect(translationService.seedOneInflightJob).toHaveBeenCalledTimes(1);
        const seedOrder = (translationService.seedOneInflightJob as jest.Mock)
          .mock.invocationCallOrder[0];
        const enqueueOrder = (jobQueueService.enqueue as jest.Mock).mock
          .invocationCallOrder[0];
        expect(seedOrder).toBeLessThan(enqueueOrder);
      });

      it("seeds in-flight counter once before each TRANSLATE_VARIANT enqueue", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const variant = createMockVariantDto({ id: 10, variantContent: "v" });
        const question = createMockQuestionDto({
          id: 1,
          question: "Q",
          alreadyInBackend: true,
          variants: [variant],
        });
        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([{ ...question, variants: [variant] }])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        variantRepository.update = jest
          .fn()
          .mockResolvedValue({ ...variant, questionId: 1 });

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [question],
          jobId,
        );

        // One seed for the question, one for the variant
        expect(translationService.seedOneInflightJob).toHaveBeenCalledWith(
          assignmentId,
        );
        expect(translationService.seedOneInflightJob).toHaveBeenCalledTimes(2);
      });

      it("rolls back in-flight seed and rethrows when TRANSLATE_QUESTION enqueue fails", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const question = createMockQuestionDto({
          id: 1,
          question: "Q",
          alreadyInBackend: true,
        });
        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([question])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });

        const enqueueError = new Error("Redis connection lost");
        (jobQueueService.enqueue as jest.Mock).mockRejectedValueOnce(
          enqueueError,
        );

        await expect(
          questionService.processQuestionsForPublishing(
            assignmentId,
            [question],
            jobId,
          ),
        ).rejects.toThrow("Redis connection lost");

        expect(translationService.seedOneInflightJob).toHaveBeenCalledWith(
          assignmentId,
        );
        expect(translationService.rollbackOneInflightSeed).toHaveBeenCalledWith(
          assignmentId,
        );
      });

      it("rolls back in-flight seed and rethrows when TRANSLATE_VARIANT enqueue fails", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const variant = createMockVariantDto({ id: 10, variantContent: "v" });
        const question = createMockQuestionDto({
          id: 1,
          question: "Q",
          alreadyInBackend: true,
          variants: [variant],
        });
        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([{ ...question, variants: [variant] }])
          .mockResolvedValueOnce([question]);
        questionRepository.updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        variantRepository.update = jest
          .fn()
          .mockResolvedValue({ ...variant, questionId: 1 });

        // Let the question enqueue succeed, make the variant enqueue fail
        const enqueueError = new Error("Queue full");
        (jobQueueService.enqueue as jest.Mock)
          .mockResolvedValueOnce(undefined) // TRANSLATE_QUESTION succeeds
          .mockRejectedValueOnce(enqueueError); // TRANSLATE_VARIANT fails

        await expect(
          questionService.processQuestionsForPublishing(
            assignmentId,
            [question],
            jobId,
          ),
        ).rejects.toThrow("Queue full");

        expect(translationService.rollbackOneInflightSeed).toHaveBeenCalledWith(
          assignmentId,
        );
        // Only one rollback — for the variant; the question seed has a live worker
        expect(
          translationService.rollbackOneInflightSeed,
        ).toHaveBeenCalledTimes(1);
      });

      it("clears stale JSON columns when the dto sends null (e.g. type switched from MCQ to TEXT)", async () => {
        const { Prisma } = await import("@prisma/client");
        const assignmentId = 1;
        const jobId = 1;

        const existing = createMockQuestionDto(
          { id: 1 },
          QuestionType.MULTIPLE_CORRECT,
        );

        const switchedToText = createMockQuestionDto({
          id: 1,
          type: QuestionType.TEXT,
          alreadyInBackend: true,
          choices: null as never,
          scoring: null as never,
          videoPresentationConfig: null as never,
          liveRecordingConfig: null as never,
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([existing])
          .mockResolvedValueOnce([switchedToText]);

        const updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        questionRepository.updateOwnedById = updateOwnedById;

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [switchedToText],
          jobId,
        );

        expect(updateOwnedById).toHaveBeenCalledTimes(1);
        const updateData = updateOwnedById.mock.calls[0][2] as Record<
          string,
          unknown
        >;
        expect(updateData.choices).toBe(Prisma.DbNull);
        expect(updateData.scoring).toBe(Prisma.DbNull);
        expect(updateData.videoPresentationConfig).toBe(Prisma.DbNull);
        expect(updateData.liveRecordingConfig).toBe(Prisma.DbNull);
      });

      it("leaves columns untouched when the dto omits them (undefined, not null)", async () => {
        const assignmentId = 1;
        const jobId = 1;

        const existing = createMockQuestionDto({ id: 1 });
        const dtoWithUndefinedJson = createMockQuestionDto({
          id: 1,
          alreadyInBackend: true,
          choices: undefined,
          scoring: undefined,
          videoPresentationConfig: undefined,
          liveRecordingConfig: undefined,
        });

        questionRepository.findByAssignmentId
          .mockResolvedValueOnce([existing])
          .mockResolvedValueOnce([dtoWithUndefinedJson]);

        const updateOwnedById = jest
          .fn()
          .mockResolvedValue({ id: 1, assignmentId });
        questionRepository.updateOwnedById = updateOwnedById;

        await questionService.processQuestionsForPublishing(
          assignmentId,
          [dtoWithUndefinedJson],
          jobId,
        );

        const updateData = updateOwnedById.mock.calls[0][2] as Record<
          string,
          unknown
        >;
        expect(updateData.choices).toBeUndefined();
        expect(updateData.scoring).toBeUndefined();
        expect(updateData.videoPresentationConfig).toBeUndefined();
        expect(updateData.liveRecordingConfig).toBeUndefined();
      });
    });

    describe("generateQuestions", () => {
      it("should start question generation job", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const mockJob = createMockJob({ id: 1 });
        const payload = createMockQuestionGenerationPayload();

        jobStatusService.createJob.mockResolvedValue(mockJob);

        const result = await questionService.generateQuestions(
          assignmentId,
          payload,
          userId,
        );

        expect(jobStatusService.createJob).toHaveBeenCalledWith(
          assignmentId,
          userId,
        );
        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          "mark.assignment.v2",
          "assignment-v2.generate-questions",
          {
            assignmentId,
            assignmentType: payload.assignmentType,
            fileContents: payload.fileContents,
            jobId: mockJob.id,
            learningObjectives: payload.learningObjectives,
            questionsToGenerate: payload.questionsToGenerate,
          },
          {
            jobId: mockJob.id,
          },
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

      it("should reject subtype mode when all multiple-choice subtype counts are zero", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const invalidPayload = createMockQuestionGenerationPayload({
          questionsToGenerate: {
            multipleChoice: 0,
            multipleSelect: 0,
            textResponse: 0,
            trueFalse: 0,
            url: 0,
            upload: 0,
            linkFile: 0,
            multipleChoiceSubtypes: {
              short: 0,
              quantitative: 0,
              long: 0,
              scenario: 0,
            },
            responseTypes: {
              TEXT: [ResponseType.ESSAY],
            },
          },
        });

        await expect(
          questionService.generateQuestions(
            assignmentId,
            invalidPayload,
            userId,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it("should accept subtype mode when at least one multiple-choice subtype count is requested", async () => {
        const assignmentId = 1;
        const userId = "author-123";
        const mockJob = createMockJob({ id: 7 });
        const payload = createMockQuestionGenerationPayload({
          questionsToGenerate: {
            multipleChoice: 0,
            multipleSelect: 0,
            textResponse: 0,
            trueFalse: 0,
            url: 0,
            upload: 0,
            linkFile: 0,
            multipleChoiceSubtypes: {
              short: 2,
              quantitative: 0,
              long: 0,
              scenario: 0,
            },
            responseTypes: {
              TEXT: [ResponseType.ESSAY],
            },
          },
        });

        jobStatusService.createJob.mockResolvedValue(mockJob);

        await expect(
          questionService.generateQuestions(assignmentId, payload, userId),
        ).resolves.toEqual({
          message: "Question generation started",
          jobId: mockJob.id,
        });

        expect(jobQueueService.enqueue).toHaveBeenCalledWith(
          "mark.assignment.v2",
          "assignment-v2.generate-questions",
          {
            assignmentId,
            assignmentType: payload.assignmentType,
            fileContents: payload.fileContents,
            jobId: mockJob.id,
            learningObjectives: payload.learningObjectives,
            questionsToGenerate: payload.questionsToGenerate,
          },
          {
            jobId: mockJob.id,
          },
        );
      });

      describe("contentSource routing", () => {
        const userId = "author-123";
        const assignmentId = 1;
        const mockJob = { id: 42 };
        const storedFile = {
          filename: "stored.txt",
          extractedText: "stored content",
        };

        beforeEach(() => {
          jobStatusService.createJob.mockResolvedValue(mockJob);
        });

        it('contentSource="payload" uses caller-supplied fileContents, never queries DB', async () => {
          const payload = createMockQuestionGenerationPayload({
            contentSource: "payload",
          });

          await questionService.generateQuestions(
            assignmentId,
            payload,
            userId,
          );

          expect(prismaService.assignmentFile.findMany).not.toHaveBeenCalled();
        });

        it('contentSource="stored" queries DB and filters to READY rows with non-null extractedText', async () => {
          prismaService.assignmentFile.findMany.mockResolvedValue([storedFile]);

          const payload = createMockQuestionGenerationPayload({
            contentSource: "stored",
            fileContents: undefined,
            learningObjectives: "some objective",
          });

          await questionService.generateQuestions(
            assignmentId,
            payload,
            userId,
          );

          expect(prismaService.assignmentFile.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
              where: expect.objectContaining({
                assignmentId,
                extractedText: { not: null },
              }),
            }),
          );
        });

        it('contentSource="stored" throws BadRequestException when no READY files exist', async () => {
          prismaService.assignmentFile.findMany.mockResolvedValue([]);

          const payload = createMockQuestionGenerationPayload({
            contentSource: "stored",
            fileContents: undefined,
            learningObjectives: "some objective",
          });

          await expect(
            questionService.generateQuestions(assignmentId, payload, userId),
          ).rejects.toThrow(BadRequestException);
        });

        it('contentSource="both" concatenates caller fileContents and stored files', async () => {
          prismaService.assignmentFile.findMany.mockResolvedValue([storedFile]);

          const callerFile = { filename: "caller.txt", content: "caller data" };
          const payload = createMockQuestionGenerationPayload({
            contentSource: "both",
            fileContents: [callerFile],
          });

          await questionService.generateQuestions(
            assignmentId,
            payload,
            userId,
          );

          const filesArg = jobQueueService.enqueue.mock.calls[0][2]
            .fileContents as Array<{
            filename: string;
            content: string;
          }>;
          const filenames = filesArg.map((f) => f.filename);
          expect(filenames).toContain("caller.txt");
          expect(filenames).toContain("stored.txt");
        });
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

      it("should append questions missing from questionOrder when building grading context", async () => {
        const assignmentId = 1;
        const mockAssignment = {
          id: assignmentId,
          questionOrder: [2, 1],
          questions: [
            { id: 1, question: "Question 1", isDeleted: false },
            { id: 2, question: "Question 2", isDeleted: false },
            { id: 3, question: "Question 3", isDeleted: false },
          ],
        };

        prismaService.assignment.findUnique.mockResolvedValue(mockAssignment);
        llmFacadeService.generateQuestionGradingContext.mockResolvedValue({
          "1": [2],
          "2": [1],
          "3": [1, 2],
        });
        prismaService.question.update.mockResolvedValue({});

        await questionService.updateQuestionGradingContext(assignmentId);

        expect(
          llmFacadeService.generateQuestionGradingContext,
        ).toHaveBeenCalledWith(
          [
            { id: 2, questionText: "Question 2" },
            { id: 1, questionText: "Question 1" },
            { id: 3, questionText: "Question 3" },
          ],
          assignmentId,
        );
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

  describe("processQuestionsForPublishing — count integrity", () => {
    interface MockRow {
      id: number;
      assignmentId: number;
      question: string;
      isDeleted: boolean;
      type: QuestionType;
    }

    let store: Map<number, MockRow>;
    let nextDbId: number;

    const seedRow = (row: MockRow): void => {
      store.set(row.id, { ...row });
    };

    const rowsForAssignment = (assignmentId: number): MockRow[] => {
      return [...store.values()].filter(
        (r) => r.assignmentId === assignmentId && r.isDeleted === false,
      );
    };

    beforeEach(() => {
      store = new Map<number, MockRow>();
      nextDbId = 100_000;

      // findByAssignmentId reads the per-assignment slice of the store
      questionRepository.findByAssignmentId.mockImplementation(
        async (assignmentId: number) =>
          rowsForAssignment(assignmentId).map(
            (r) =>
              ({
                id: r.id,
                assignmentId: r.assignmentId,
                question: r.question,
                type: r.type,
                isDeleted: r.isDeleted,
                choices: undefined,
                scoring: undefined,
                gradingContextQuestionIds: [],
                variants: [],
                alreadyInBackend: true,
              }) as unknown as QuestionDto,
          ),
      );

      // markAsDeleted flips isDeleted on whichever row id was passed (matches current production)
      questionRepository.markAsDeleted.mockImplementation(
        async (ids: number[]) => {
          for (const id of ids) {
            const existing = store.get(id);
            if (existing) {
              store.set(id, { ...existing, isDeleted: true });
            }
          }
        },
      );

      // upsert: GLOBAL by id (mirrors the current production bug). If the id exists
      // anywhere in the store, update that row's content (keeping its assignmentId).
      // If not, create a new row with the supplied id under the supplied assignmentId.
      // This is the behavior we want the new code to AVOID.
      questionRepository.upsert.mockImplementation(
        async (input: QuestionDto) => {
          const existing = store.get(input.id);
          if (existing) {
            const next: MockRow = {
              ...existing,
              question: input.question,
              type: input.type,
              isDeleted: input.isDeleted ?? false,
            };
            store.set(input.id, next);
            return {
              id: existing.id,
              assignmentId: existing.assignmentId,
            } as unknown as Awaited<
              ReturnType<typeof questionRepository.upsert>
            >;
          }
          const created: MockRow = {
            id: input.id,
            assignmentId: input.assignmentId,
            question: input.question,
            type: input.type,
            isDeleted: false,
          };
          store.set(input.id, created);
          return {
            id: created.id,
            assignmentId: created.assignmentId,
          } as unknown as Awaited<ReturnType<typeof questionRepository.upsert>>;
        },
      );

      // createForAssignment: server-allocates a fresh id; ignores any client id.
      questionRepository.createForAssignment = jest
        .fn()
        .mockImplementation(
          async (input: Omit<QuestionDto, "id">, assignmentId: number) => {
            const id = nextDbId++;
            const created: MockRow = {
              id,
              assignmentId,
              question: input.question,
              type: input.type,
              isDeleted: false,
            };
            store.set(id, created);
            return { id, assignmentId } as unknown as Awaited<
              ReturnType<
                NonNullable<typeof questionRepository.createForAssignment>
              >
            >;
          },
        );

      // updateOwnedById: only updates if the row's assignmentId matches.
      questionRepository.updateOwnedById = jest
        .fn()
        .mockImplementation(
          async (
            id: number,
            assignmentId: number,
            update: Partial<QuestionDto>,
          ) => {
            const existing = store.get(id);
            if (
              !existing ||
              existing.assignmentId !== assignmentId ||
              existing.isDeleted
            ) {
              return null;
            }
            const next: MockRow = {
              ...existing,
              question:
                typeof update.question === "string"
                  ? update.question
                  : existing.question,
              type: (update.type ?? existing.type) as QuestionType,
              isDeleted: update.isDeleted ?? existing.isDeleted,
            };
            store.set(id, next);
            return { id: next.id, assignmentId: next.assignmentId };
          },
        );
    });

    it("publishes 25 imported questions with random client IDs and persists exactly 25 rows for the target assignment", async () => {
      const targetAssignmentId = 1;
      const otherAssignmentId = 999;

      // Real-world DB shape: target assignment is fresh (no rows yet), but the
      // global Question table has rows belonging to other assignments. Imported
      // questions arrive with random client-side ids whose range collides with
      // those other-assignment rows.
      const seed = 0xa5a5;
      let lcg = seed;
      const nextRandom = (): number => {
        lcg = (lcg * 1_103_515_245 + 12_345) & 0x7fff_ffff;
        return lcg;
      };

      const incoming: QuestionDto[] = [];
      const usedIds = new Set<number>();
      while (incoming.length < 25) {
        const id = nextRandom();
        if (usedIds.has(id)) continue;
        usedIds.add(id);
        incoming.push(
          createMockQuestionDto({
            id,
            assignmentId: targetAssignmentId,
            alreadyInBackend: false,
            question: `IMPORTED_Q_${incoming.length + 1}`,
          }),
        );
      }

      // Pre-seed half of the random ids as foreign-assignment rows. With a global
      // Question.id space, these collisions cause the buggy upsert path to
      // mutate foreign rows instead of inserting new ones for the target.
      const incomingIds = incoming.map((q) => q.id);
      for (let index = 0; index < incoming.length; index += 2) {
        seedRow({
          id: incomingIds[index],
          assignmentId: otherAssignmentId,
          question: `FOREIGN_DECOY_${index}`,
          isDeleted: false,
          type: QuestionType.SINGLE_CORRECT,
        });
      }

      await questionService.processQuestionsForPublishing(
        targetAssignmentId,
        incoming,
      );

      const finalRows = rowsForAssignment(targetAssignmentId);
      expect(finalRows).toHaveLength(25);

      const finalIds = new Set(finalRows.map((r) => r.id));
      expect(finalIds.size).toBe(25);

      const finalContents = new Set(finalRows.map((r) => r.question));
      for (let index = 1; index <= 25; index++) {
        expect(finalContents.has(`IMPORTED_Q_${index}`)).toBe(true);
      }
    });

    it("publishing does not mutate questions belonging to other assignments even when client-supplied IDs collide", async () => {
      const targetAssignmentId = 1;
      const otherAssignmentId = 999;
      const collidingIds = [1001, 1002, 1003, 1004, 1005];

      for (const [index, id] of collidingIds.entries()) {
        seedRow({
          id,
          assignmentId: otherAssignmentId,
          question: `OTHER_ORIGINAL_${index + 1}`,
          isDeleted: false,
          type: QuestionType.SINGLE_CORRECT,
        });
      }

      const otherSnapshot = collidingIds.map((id) => {
        const row = store.get(id);
        if (!row) {
          throw new Error("seed row missing");
        }
        return { ...row };
      });

      const payload: QuestionDto[] = collidingIds.map((id, index) =>
        createMockQuestionDto({
          id,
          assignmentId: targetAssignmentId,
          alreadyInBackend: false,
          question: `TARGET_NEW_${index + 1}`,
        }),
      );

      await questionService.processQuestionsForPublishing(
        targetAssignmentId,
        payload,
      );

      // Other-assignment rows must be byte-identical
      for (const [index, id] of collidingIds.entries()) {
        const after = store.get(id);
        expect(after).toBeDefined();
        expect(after).toEqual(otherSnapshot[index]);
      }

      // Target assignment must end with 5 NEW rows whose ids are NOT the colliding ids
      const targetRows = rowsForAssignment(targetAssignmentId);
      expect(targetRows).toHaveLength(5);
      const targetIds = targetRows.map((r) => r.id);
      for (const id of collidingIds) {
        expect(targetIds).not.toContain(id);
      }
      const targetContents = new Set(targetRows.map((r) => r.question));
      for (let index = 1; index <= 5; index++) {
        expect(targetContents.has(`TARGET_NEW_${index}`)).toBe(true);
      }
    });

    it("rejects payload with duplicate question IDs that both claim to be already in backend", async () => {
      const targetAssignmentId = 1;
      const duplicatedId = 42;

      // Seed the duplicated id as a real row in the target assignment so both entries
      // genuinely look like updates to the same row.
      seedRow({
        id: duplicatedId,
        assignmentId: targetAssignmentId,
        question: "EXISTING_Q",
        isDeleted: false,
        type: QuestionType.SINGLE_CORRECT,
      });

      const payload: QuestionDto[] = [
        createMockQuestionDto({
          id: duplicatedId,
          assignmentId: targetAssignmentId,
          alreadyInBackend: true,
          question: "DUP_A",
        }),
        createMockQuestionDto({
          id: duplicatedId,
          assignmentId: targetAssignmentId,
          alreadyInBackend: true,
          question: "DUP_B",
        }),
        createMockQuestionDto({
          id: 7,
          assignmentId: targetAssignmentId,
          alreadyInBackend: false,
          question: "FRESH",
        }),
      ];

      await expect(
        questionService.processQuestionsForPublishing(
          targetAssignmentId,
          payload,
        ),
      ).rejects.toThrow(BadRequestException);

      // Generic message — must not echo field names
      try {
        await questionService.processQuestionsForPublishing(
          targetAssignmentId,
          payload,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toMatch(/duplicateIds|alreadyInBackend|field/i);
        expect(message.toLowerCase()).toContain("invalid");
      }
    });
  });
});
