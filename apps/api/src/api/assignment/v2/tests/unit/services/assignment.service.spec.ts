/* eslint-disable unicorn/no-array-push-push */
/* eslint-disable unicorn/no-null */
/* eslint-disable unicorn/no-useless-undefined */
/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UpdateAssignmentRequestDto } from "src/api/assignment/dto/update.assignment.request.dto";
import {
  UpdateAssignmentQuestionsDto,
  VariantType as VariantTypeDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionService } from "src/api/assignment/v2/services/question.service";
import { AttemptAccessCacheService } from "src/api/attempt/services/attempt-access-cache.service";
import { AiFeatureFlagsService } from "src/api/ai-feature-flags/ai-feature-flags.service";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PrismaService } from "src/database/prisma.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobQueueService } from "src/job-queue/job-queue.service";
import {
  createMockAssignmentRepository,
  createMockAssignmentResponseDto,
  createMockGetAssignmentResponseDto,
  createMockJobQueueService,
  createMockJobStatusService,
  createMockLearnerGetAssignmentResponseDto,
  createMockLlmFacadeService,
  createMockLogger,
  createMockPrismaService,
  createMockQuestion,
  createMockQuestionDto,
  createMockQuestionService,
  createMockReplaceAssignmentDto,
  createMockTranslationService,
  createMockUpdateAssignmentDto,
  createMockUpdateAssignmentQuestionsDto,
  createMockVersionManagementService,
  sampleAuthorSession,
  sampleLearnerSession,
} from "../__mocks__/ common-mocks";
import { AssignmentRepository } from "../../../repositories/assignment.repository";
import { AssignmentServiceV2 } from "../../../services/assignment.service";
import { JobStatusServiceV2 } from "../../../services/job-status.service";
import { TranslationService } from "../../../services/translation.service";
import { VersionManagementService } from "../../../services/version-management.service";

describe("AssignmentServiceV2 – full unit-suite", () => {
  let service: AssignmentServiceV2;
  let assignmentRepository: ReturnType<typeof createMockAssignmentRepository>;
  let questionService: ReturnType<typeof createMockQuestionService>;
  let translationService: ReturnType<typeof createMockTranslationService>;
  let versionManagementService: ReturnType<
    typeof createMockVersionManagementService
  >;
  let jobStatusService: ReturnType<typeof createMockJobStatusService>;
  let jobQueueService: ReturnType<typeof createMockJobQueueService>;
  let prismaService: ReturnType<typeof createMockPrismaService>;
  let attemptAccessCache: { invalidateForAssignment: jest.Mock };
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(async () => {
    assignmentRepository = createMockAssignmentRepository();
    questionService = createMockQuestionService();
    translationService = createMockTranslationService();
    versionManagementService = createMockVersionManagementService();
    jobStatusService = createMockJobStatusService();
    jobQueueService = createMockJobQueueService();
    prismaService = createMockPrismaService();
    attemptAccessCache = {
      invalidateForAssignment: jest.fn().mockResolvedValue(undefined),
    };
    const llmService = createMockLlmFacadeService();
    logger = createMockLogger();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentServiceV2,
        { provide: AssignmentRepository, useValue: assignmentRepository },
        { provide: QuestionService, useValue: questionService },
        { provide: TranslationService, useValue: translationService },
        {
          provide: VersionManagementService,
          useValue: versionManagementService,
        },
        { provide: JobStatusServiceV2, useValue: jobStatusService },
        { provide: JobQueueService, useValue: jobQueueService },
        { provide: LlmFacadeService, useValue: llmService },
        { provide: PrismaService, useValue: prismaService },
        { provide: AttemptAccessCacheService, useValue: attemptAccessCache },
        {
          provide: AiFeatureFlagsService,
          useValue: { isDisabled: () => false },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: { child: () => logger } },
      ],
    }).compile();

    service = module.get(AssignmentServiceV2);
  });

  afterEach(() => jest.clearAllMocks());

  it("service should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getAssignment", () => {
    it("returns learner view without translation", async () => {
      const mockAssignment = createMockLearnerGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      const response = await service.getAssignment(1, sampleLearnerSession);

      expect(response).toEqual(mockAssignment);
      expect(assignmentRepository.findById).toHaveBeenCalledWith(
        1,
        sampleLearnerSession,
      );
      expect(
        translationService.applyTranslationsToAssignment,
      ).not.toHaveBeenCalled();
    });

    it("returns author view without translation", async () => {
      const mockAssignment = createMockGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      const response = await service.getAssignment(1, sampleAuthorSession);

      expect(response).toEqual(mockAssignment);
      expect(assignmentRepository.findById).toHaveBeenCalledWith(
        1,
        sampleAuthorSession,
      );
      expect(
        translationService.applyTranslationsToAssignment,
      ).not.toHaveBeenCalled();
    });

    it("applies translation when languageCode supplied", async () => {
      const mockAssignment = createMockGetAssignmentResponseDto();
      assignmentRepository.findById.mockResolvedValueOnce(mockAssignment);

      await service.getAssignment(1, sampleAuthorSession, "fr");

      expect(
        translationService.applyTranslationsToAssignment,
      ).toHaveBeenCalledWith(mockAssignment, "fr");
    });
  });

  describe("listAssignments", () => {
    it("lists all assignments for a user", async () => {
      const list = [createMockAssignmentResponseDto()];
      assignmentRepository.findAllForUser.mockResolvedValueOnce(list);

      const response = await service.listAssignments(sampleAuthorSession);

      expect(response).toEqual(list);
      expect(assignmentRepository.findAllForUser).toHaveBeenCalledWith(
        sampleAuthorSession,
      );
    });
  });

  describe("updateAssignment", () => {
    it("updates & triggers translation and grading-context update", async () => {
      const dto: UpdateAssignmentRequestDto = createMockUpdateAssignmentDto({
        name: "Updated name",
      });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(true);

      await service.updateAssignment(1, dto);

      expect(assignmentRepository.update).toHaveBeenCalledWith(1, dto);
      expect(jobQueueService.enqueue).toHaveBeenCalledWith(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        JOB_NAMES.TRANSLATE_META,
        expect.objectContaining({ assignmentId: 1 }),
        expect.objectContaining({ attempts: 3 }),
      );
      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        1,
      );
    });

    it("skips translation when non-translatable changes only", async () => {
      const dto = createMockUpdateAssignmentDto({ graded: true });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(false);

      await service.updateAssignment(1, dto);

      expect(translationService.translateAssignment).not.toHaveBeenCalled();
    });

    it("updates grading context when published toggled on", async () => {
      const dto = createMockUpdateAssignmentDto({ published: true });
      jest
        .spyOn<any, any>(service as any, "shouldTranslateAssignment")
        .mockReturnValue(false);

      await service.updateAssignment(1, dto);

      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        1,
      );
    });
  });

  describe("replaceAssignment", () => {
    it("replaces assignment entirely", async () => {
      const dto = createMockReplaceAssignmentDto();

      const response = await service.replaceAssignment(1, dto);

      expect(response).toEqual({ id: 1, success: true });
      expect(assignmentRepository.replace).toHaveBeenCalledWith(1, dto);
    });
  });

  describe("getAvailableLanguages", () => {
    it("returns language list", async () => {
      const langs = ["en", "fr", "es"];
      translationService.getAvailableLanguages.mockResolvedValueOnce(langs);

      const response = await service.getAvailableLanguages(1);

      expect(response).toEqual(langs);
      expect(translationService.getAvailableLanguages).toHaveBeenCalledWith(1);
    });
  });

  describe("publishAssignment", () => {
    it("kicks off publishing and returns job info", async () => {
      const dto: UpdateAssignmentQuestionsDto =
        createMockUpdateAssignmentQuestionsDto();

      const response = await service.publishAssignment(1, dto, "author-123");

      expect(jobQueueService.findActiveJob).toHaveBeenCalledWith(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        "publish:v2:1",
      );
      expect(jobStatusService.createPublishJob).toHaveBeenCalledWith(
        1,
        "author-123",
        { reservedId: "publish:v2:1" },
      );
      expect(jobQueueService.enqueue).toHaveBeenCalledWith(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
        {
          assignmentId: 1,
          jobId: 1,
          updateDto: dto,
          userId: "author-123",
        },
        {
          jobId: 1,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      expect(response).toEqual({ jobId: 1, message: "Publishing started" });
    });

    it("marks the job failed and rethrows if queue enqueue fails", async () => {
      const dto = createMockUpdateAssignmentQuestionsDto();
      jobQueueService.enqueue.mockRejectedValueOnce(new Error("fail"));

      await expect(
        service.publishAssignment(1, dto, "author-123"),
      ).rejects.toThrow("fail");
      expect(jobStatusService.updateJobStatus).toHaveBeenCalledWith(1, {
        status: "Failed",
        progress: "Failed to enqueue publish job: fail",
      });
    });
  });

  describe("publishAssignment question-pool clamping", () => {
    const enqueuedDto = () =>
      (jobQueueService.enqueue as jest.Mock).mock.calls[0][2]
        .updateDto as UpdateAssignmentQuestionsDto;

    it("clamps numberOfQuestionsPerAttempt to the question pool instead of rejecting", async () => {
      const dto = createMockUpdateAssignmentQuestionsDto({
        numberOfQuestionsPerAttempt: 15,
      });

      const response = await service.publishAssignment(1, dto, "author-123");

      expect(response).toEqual({ jobId: 1, message: "Publishing started" });
      // The clamped value is what gets enqueued, so runPublishJob persists it.
      expect(enqueuedDto().numberOfQuestionsPerAttempt).toBe(
        dto.questions.filter((question) => !question.isDeleted).length,
      );
    });

    it("counts only non-deleted questions when clamping", async () => {
      const dto = createMockUpdateAssignmentQuestionsDto({
        numberOfQuestionsPerAttempt: 2,
        questions: [
          createMockQuestionDto(),
          createMockQuestionDto({ id: 2, isDeleted: true }),
        ],
      });

      await service.publishAssignment(1, dto, "author-123");

      expect(enqueuedDto().numberOfQuestionsPerAttempt).toBe(1);
    });

    it("leaves numberOfQuestionsPerAttempt alone when the pool can satisfy it", async () => {
      const dto = createMockUpdateAssignmentQuestionsDto({
        numberOfQuestionsPerAttempt: 2,
      });

      const response = await service.publishAssignment(1, dto, "author-123");

      expect(response).toEqual({ jobId: 1, message: "Publishing started" });
      expect(enqueuedDto().numberOfQuestionsPerAttempt).toBe(2);
    });
  });

  describe("runPublishJob", () => {
    it("runs all steps when content changes", async () => {
      const assignmentId = 1;
      const jobId = 1;
      const dto = createMockUpdateAssignmentQuestionsDto();

      jest
        .spyOn<
          any,
          any
        >(service as any, "haveTranslatableAssignmentFieldsChanged")
        .mockReturnValue(true);
      jest
        .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
        .mockReturnValue(true);

      await service.runPublishJob(jobId, assignmentId, dto, "author-123");

      expect(
        questionService.processQuestionsForPublishing,
      ).toHaveBeenCalledWith(
        assignmentId,
        dto.questions,
        expect.anything(),
        expect.anything(),
      );
      // runPublishJob now fans out per-question translation jobs through
      // question.service (which enqueues each), and SADD-seeds the in-flight
      // SET when redis is available. No direct translationService.translateAssignment
      // call from the publish path anymore.
      expect(translationService.translateAssignment).not.toHaveBeenCalled();
      expect(questionService.updateQuestionGradingContext).toHaveBeenCalledWith(
        assignmentId,
      );
      expect(assignmentRepository.update).toHaveBeenCalledWith(
        assignmentId,
        expect.objectContaining({ published: true }),
      );
      expect(jobStatusService.updateJobStatus).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({ status: "Completed" }),
      );
    });

    it("invalidates the attempt-access cache for the assignment after a successful publish", async () => {
      const assignmentId = 42;
      const jobId = 7;
      const dto = createMockUpdateAssignmentQuestionsDto();

      jest
        .spyOn<
          any,
          any
        >(service as any, "haveTranslatableAssignmentFieldsChanged")
        .mockReturnValue(true);
      jest
        .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
        .mockReturnValue(true);

      await service.runPublishJob(jobId, assignmentId, dto, "author-123");

      expect(attemptAccessCache.invalidateForAssignment).toHaveBeenCalledTimes(
        1,
      );
      expect(attemptAccessCache.invalidateForAssignment).toHaveBeenCalledWith(
        assignmentId,
      );

      const completedCallIndex =
        jobStatusService.updateJobStatus.mock.calls.findIndex(
          ([, payload]: [unknown, { status?: string }]) =>
            payload?.status === "Completed",
        );
      const invalidateCallOrder =
        attemptAccessCache.invalidateForAssignment.mock.invocationCallOrder[0];
      const completedCallOrder =
        jobStatusService.updateJobStatus.mock.invocationCallOrder[
          completedCallIndex
        ];
      expect(invalidateCallOrder).toBeLessThan(completedCallOrder);
    });
  });

  it("skips translation & grading-context when only configuration changes", async () => {
    const assignmentId = 1;
    const jobId = 1;
    const dto = createMockUpdateAssignmentQuestionsDto({
      graded: true,
      numAttempts: 3,
    });

    jest
      .spyOn<
        any,
        any
      >(service as any, "haveTranslatableAssignmentFieldsChanged")
      .mockReturnValue(false);
    jest
      .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
      .mockReturnValue(false);

    const existingAssignment = createMockGetAssignmentResponseDto({
      published: true,
    });
    assignmentRepository.findById.mockResolvedValue(existingAssignment);

    await service.runPublishJob(jobId, assignmentId, dto, "author-123");

    expect(translationService.translateAssignment).not.toHaveBeenCalled();
    expect(questionService.updateQuestionGradingContext).not.toHaveBeenCalled();
  });

  it("preserves question order when publishing config-only changes", async () => {
    const assignmentId = 1;
    const jobId = 1;
    const dto = createMockUpdateAssignmentQuestionsDto(
      { questions: undefined, questionOrder: undefined },
      false,
    );

    const existingAssignment = createMockGetAssignmentResponseDto(
      { questionOrder: [3, 2, 1] },
      [
        createMockQuestion({ id: 1 }),
        createMockQuestion({ id: 2 }),
        createMockQuestion({ id: 3 }),
      ],
    );
    assignmentRepository.findById.mockResolvedValue(existingAssignment);
    questionService.getQuestionsForAssignment.mockResolvedValue([
      createMockQuestionDto({ id: 1 }),
      createMockQuestionDto({ id: 2 }),
      createMockQuestionDto({ id: 3 }),
    ]);

    jest
      .spyOn<
        any,
        any
      >(service as any, "haveTranslatableAssignmentFieldsChanged")
      .mockReturnValue(false);

    await service.runPublishJob(jobId, assignmentId, dto, "author-123");

    expect(assignmentRepository.update).toHaveBeenCalledWith(
      assignmentId,
      expect.objectContaining({ questionOrder: [3, 2, 1] }),
    );
  });

  it("maps temporary frontend question ids to persisted backend ids before saving question order", async () => {
    const assignmentId = 1;
    const jobId = "publish-job-1";
    const tempQuestionId = 966_122_647;
    const persistedQuestionId = 3;
    const dto = createMockUpdateAssignmentQuestionsDto(
      {
        questionOrder: [1, tempQuestionId, 2],
        questions: [
          createMockQuestionDto({ id: 1 }),
          createMockQuestionDto({ id: tempQuestionId }),
          createMockQuestionDto({ id: 2 }),
        ],
      },
      false,
    );

    const existingAssignment = createMockGetAssignmentResponseDto(
      { published: true, questionOrder: [1, 2] },
      [createMockQuestion({ id: 1 }), createMockQuestion({ id: 2 })],
    );
    assignmentRepository.findById.mockResolvedValue(existingAssignment);
    questionService.processQuestionsForPublishing.mockResolvedValue({
      idMap: new Map([[tempQuestionId, persistedQuestionId]]),
      translationJobsEnqueued: 1,
    });
    questionService.getQuestionsForAssignment.mockResolvedValue([
      createMockQuestionDto({ id: 1 }),
      createMockQuestionDto({ id: 2 }),
      createMockQuestionDto({ id: persistedQuestionId }),
    ]);

    jest
      .spyOn<
        any,
        any
      >(service as any, "haveTranslatableAssignmentFieldsChanged")
      .mockReturnValue(false);
    jest
      .spyOn<any, any>(service as any, "haveQuestionContentsChanged")
      .mockReturnValue(false);

    await service.runPublishJob(jobId, assignmentId, dto, "author-123");

    expect(assignmentRepository.update).toHaveBeenCalledWith(
      assignmentId,
      expect.objectContaining({ questionOrder: [1, persistedQuestionId, 2] }),
    );
  });

  describe("resolveQuestionOrder", () => {
    it("uses explicit questionOrder even when questions payload is absent", () => {
      const existingAssignment = createMockGetAssignmentResponseDto();
      const dto = createMockUpdateAssignmentQuestionsDto(
        { questionOrder: [2, 1], questions: undefined },
        false,
      );

      const order = service["resolveQuestionOrder"](dto, existingAssignment);

      expect(order).toEqual([2, 1]);
    });

    it("falls back to existing assignment order when nothing new is supplied", () => {
      const existingAssignment = createMockGetAssignmentResponseDto(
        { questionOrder: [3, 1, 2] },
        [
          createMockQuestion({ id: 3 }),
          createMockQuestion({ id: 1 }),
          createMockQuestion({ id: 2 }),
        ],
      );
      const dto = createMockUpdateAssignmentQuestionsDto(
        { questions: undefined, questionOrder: undefined },
        false,
      );

      const order = service["resolveQuestionOrder"](dto, existingAssignment);

      expect(order).toEqual([3, 1, 2]);
    });

    it("derives order from updated questions when explicit order is missing", () => {
      const existingAssignment = createMockGetAssignmentResponseDto();
      const dto = createMockUpdateAssignmentQuestionsDto();
      dto.questions = [
        createMockQuestionDto({ id: 10 }),
        createMockQuestionDto({ id: 11 }),
      ];
      dto.questionOrder = undefined;

      const order = service["resolveQuestionOrder"](dto, existingAssignment);

      expect(order).toEqual([10, 11]);
    });

    it("drops invalid ids and deduplicates while keeping valid order", () => {
      const existingAssignment = createMockGetAssignmentResponseDto();
      const dto = createMockUpdateAssignmentQuestionsDto(
        { questionOrder: [99, 1, 1, 2], questions: undefined },
        false,
      );

      const order = service["resolveQuestionOrder"](dto, existingAssignment);

      expect(order).toEqual([1, 2]);
    });
  });

  describe("haveTranslatableAssignmentFieldsChanged", () => {
    it.each([
      ["name", { name: "New name" }],
      ["instructions", { instructions: "New inst" }],
      ["introduction", { introduction: "New intro" }],
      ["gradingCriteriaOverview", { gradingCriteriaOverview: "New rubric" }],
    ])("returns true when %s changes", (_, patch) => {
      const existing = createMockGetAssignmentResponseDto();
      const dto = createMockUpdateAssignmentDto(patch);

      expect(
        service["haveTranslatableAssignmentFieldsChanged"](existing, dto),
      ).toBe(true);
    });

    it("returns false when only non-translatable fields change", () => {
      const existingAssignment = createMockGetAssignmentResponseDto();

      const dto: UpdateAssignmentRequestDto = {
        name: existingAssignment.name,
        introduction: existingAssignment.introduction,
        instructions: existingAssignment.instructions,
        gradingCriteriaOverview: existingAssignment.gradingCriteriaOverview,
        graded: !existingAssignment.graded,
        numAttempts: (existingAssignment.numAttempts ?? 0) + 1,
        passingGrade: (existingAssignment.passingGrade ?? 50) + 5,
        published: existingAssignment.published,
        timeEstimateMinutes: 0,
        attemptsPerTimeRange: 0,
        attemptsTimeRangeHours: 0,
        retakeAttemptCoolDownMinutes: 5,
        attemptsBeforeCoolDown: 1,
        displayOrder: "DEFINED",
        questionDisplay: "ONE_PER_PAGE",
        questionOrder: [],
        showAssignmentScore: false,
        showQuestionScore: false,
        showSubmissionFeedback: false,
        showQuestions: false,
        correctAnswerVisibility: "NEVER",
      };

      expect(
        service["haveTranslatableAssignmentFieldsChanged"](
          existingAssignment,
          dto,
        ),
      ).toBe(false);
    });
  });

  describe("haveQuestionContentsChanged", () => {
    it("detects question count change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects question text change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [createMockQuestionDto({ question: "Different text" })];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects type change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto({}, QuestionType.MULTIPLE_CORRECT),
      ];
      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects choices change", () => {
      const existing = [createMockQuestionDto()];
      const updated = [
        createMockQuestionDto({
          choices: [{ ...createMockQuestionDto().choices[0], points: 999 }],
        }),
      ];
      jest
        .spyOn<any, any>(service as any, "areChoicesEqual")
        .mockReturnValue(false);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("detects variants change", () => {
      const existing = [
        createMockQuestionDto({
          variants: [
            {
              id: 101,
              variantContent: "A",
              variantType: VariantTypeDto.REWORDED,
            },
          ],
        }),
      ];
      const updated = [
        createMockQuestionDto({
          variants: [
            {
              id: 101,
              variantContent: "B",
              variantType: VariantTypeDto.REWORDED,
            },
          ],
        }),
      ];
      jest
        .spyOn<any, any>(service as any, "haveVariantsChanged")
        .mockReturnValue(true);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        true,
      );
    });

    it("returns false when nothing changes", () => {
      const existing = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      const updated = [
        createMockQuestionDto(),
        createMockQuestionDto({ id: 2 }, QuestionType.MULTIPLE_CORRECT),
      ];
      jest
        .spyOn<any, any>(service as any, "areChoicesEqual")
        .mockReturnValue(true);
      jest
        .spyOn<any, any>(service as any, "haveVariantsChanged")
        .mockReturnValue(false);

      expect(service["haveQuestionContentsChanged"](existing, updated)).toBe(
        false,
      );
    });
  });

  describe("safeStringCompare", () => {
    it.each([
      ["same strings", "hello", "hello", true],
      ["different strings", "hello", "world", false],
      ["null vs undefined", null, undefined, true],
      ["number vs string", 123, "123", true],
      ["boolean vs string", true, "true", true],
    ])("%s", (_, a, b, expected) => {
      return expect(
        service["safeStringCompare"](
          a,
          b as string | number | boolean | null | undefined,
        ),
      ).toBe(expected);
    });
  });
});
