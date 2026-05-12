/* eslint-disable */
jest.mock("src/api/assignment/attempt/helper/languages", () => ({
  getAllLanguageCodes: () => ["en", "es", "fr"],
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JobStatusServiceV2 } from "src/api/assignment/v2/services/job-status.service";
import { TranslationService } from "src/api/assignment/v2/services/translation.service";
import { PrismaService } from "src/database/prisma.service";
import { JobQueueService } from "src/job-queue/job-queue.service";
import { TranslationMaintenanceController } from "./translation-maintenance.controller";

describe("TranslationMaintenanceController", () => {
  let controller: TranslationMaintenanceController;
  const request = {
    userSession: {
      userId: "admin-1",
    },
  } as any;
  let prisma: {
    assignment: { findUnique: jest.Mock; findMany: jest.Mock };
    assignmentTranslation: { findMany: jest.Mock; groupBy: jest.Mock };
    question: { findMany: jest.Mock };
    translation: { deleteMany: jest.Mock };
    publishJob: { findUnique: jest.Mock };
  };
  let translationService: {
    translateAssignment: jest.Mock;
    translateAssignmentForLanguages: jest.Mock;
    detectLanguage: jest.Mock;
    translateContentToLanguages: jest.Mock;
  };
  let jobStatusService: {
    createPublishJob: jest.Mock;
    updateJobStatus: jest.Mock;
  };
  let jobQueueService: {
    enqueue: jest.Mock;
  };

  const runFixJob = async (
    body: Record<string, unknown>,
    assignmentIds = [1],
  ) =>
    controller.runFixMissingTranslationsJob(
      "job-42",
      assignmentIds,
      body as any,
    );

  beforeEach(async () => {
    prisma = {
      assignment: { findUnique: jest.fn(), findMany: jest.fn() },
      assignmentTranslation: {
        findMany: jest.fn(),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      question: { findMany: jest.fn() },
      translation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      publishJob: { findUnique: jest.fn() },
    };

    translationService = {
      translateAssignment: jest.fn().mockResolvedValue(undefined),
      translateAssignmentForLanguages: jest.fn().mockResolvedValue(undefined),
      detectLanguage: jest.fn().mockResolvedValue("en"),
      translateContentToLanguages: jest
        .fn()
        .mockImplementation(
          (
            _assignmentId: number,
            _questionId: number,
            _variantId: number | null,
            _text: string,
            _choices: unknown,
            _sourceLanguage: string,
            targetLanguages: string[],
          ) =>
            Promise.resolve({
              success: targetLanguages.length,
              failure: 0,
              successfulLanguages: targetLanguages,
              failedLanguages: [],
            }),
        ),
    };

    jobStatusService = {
      createPublishJob: jest.fn().mockResolvedValue({ id: "job-42" }),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };

    jobQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranslationMaintenanceController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: TranslationService, useValue: translationService },
        { provide: JobStatusServiceV2, useValue: jobStatusService },
        { provide: JobQueueService, useValue: jobQueueService },
      ],
    }).compile();

    controller = module.get<TranslationMaintenanceController>(
      TranslationMaintenanceController,
    );
  });

  it("returns a job ID immediately without waiting for translations", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    const result = await controller.fixMissingTranslations(
      {
        assignmentId: 1,
        dryRun: false,
      },
      request,
    );

    expect(result.success).toBe(true);
    expect(result.jobId).toBe("job-42");
    expect(typeof result.message).toBe("string");
    expect(result.assignmentIds).toEqual([1]);
    expect(jobStatusService.createPublishJob).toHaveBeenCalledWith(
      1,
      "admin-1",
      expect.objectContaining({
        jobName: "admin.fix-missing-translations",
        queueName: "mark.admin.translation",
      }),
    );
    expect(jobQueueService.enqueue).toHaveBeenCalledWith(
      "mark.admin.translation",
      "admin.fix-missing-translations",
      {
        assignmentIds: [1],
        body: { assignmentId: 1, dryRun: false },
        jobId: "job-42",
      },
      {
        jobId: "job-42",
      },
    );
  });

  it("marks the job as Failed when queue enqueueing fails", async () => {
    jobQueueService.enqueue.mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );

    await expect(
      controller.fixMissingTranslations(
        {
          assignmentId: 1,
          dryRun: false,
        },
        request,
      ),
    ).rejects.toThrow("Redis unavailable");

    expect(jobStatusService.updateJobStatus).toHaveBeenCalledWith("job-42", {
      status: "Failed",
      progress: "Failed to enqueue translation fix job: Redis unavailable",
    });
  });
  it("uses the active (current) version questions, not the most recently created version", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        id: 10,
        questionVersions: [
          {
            questionId: 20,
            question: "Active version question",
            type: "MULTIPLE_CHOICE",
            totalPoints: 1,
            choices: null,
            gradingContextQuestionIds: [],
          },
        ],
      },
    });

    prisma.question.findMany.mockResolvedValue([{ id: 20, variants: [] }]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    expect(translationService.detectLanguage).toHaveBeenCalledWith(
      "Active version question",
      1,
    );
  });

  it("falls back to base questions when there is no active version", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 99,
        question: "Base question text",
        choices: null,
        variants: [],
      },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    expect(translationService.detectLanguage).toHaveBeenCalledWith(
      "Base question text",
      1,
    );
  });

  it("translates only the requested languages when languageCodes is specified", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: 5,
        question: "Question text",
        choices: null,
        variants: [],
      },
    ]);

    await runFixJob({
      assignmentId: 1,
      languageCodes: ["es"],
      dryRun: false,
    });

    const [, , , , , , targetLanguages] =
      translationService.translateContentToLanguages.mock.calls[0];
    expect(targetLanguages).toEqual(["es"]);
    expect(targetLanguages).not.toContain("fr");
  });

  it("translates all supported languages when no languageCodes filter is given", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      {
        id: 5,
        question: "Question text",
        choices: null,
        variants: [],
      },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    const [, , , , , , targetLanguages] =
      translationService.translateContentToLanguages.mock.calls[0];
    expect(targetLanguages).toEqual(["en", "es", "fr"]);
  });

  it("passes choices from questionVersion to translateContentToLanguages", async () => {
    const choices = [
      { id: "a", text: "Option A" },
      { id: "b", text: "Option B" },
    ];

    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        id: 10,
        questionVersions: [
          {
            questionId: 7,
            question: "Pick one",
            choices,
            gradingContextQuestionIds: [],
          },
        ],
      },
    });
    prisma.question.findMany.mockResolvedValue([{ id: 7, variants: [] }]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    const [, , , , passedChoices] =
      translationService.translateContentToLanguages.mock.calls[0];
    expect(passedChoices).toEqual(choices);
  });

  it("translates variants when the base question record exists", async () => {
    const variantChoices = [{ id: "x", text: "Variant choice" }];

    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        id: 10,
        questionVersions: [
          {
            questionId: 8,
            question: "Question text",
            choices: null,
            gradingContextQuestionIds: [],
          },
        ],
      },
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 8,
        variants: [
          {
            id: 101,
            variantContent: "Variant text",
            choices: variantChoices,
          },
        ],
      },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    expect(
      translationService.translateContentToLanguages,
    ).toHaveBeenCalledTimes(2);

    const variantCall =
      translationService.translateContentToLanguages.mock.calls.find(
        ([, , variantId]) => variantId === 101,
      );
    expect(variantCall).toBeDefined();
    expect(variantCall[3]).toBe("Variant text");
    expect(variantCall[4]).toEqual(variantChoices);
  });

  it("does not delete translations directly in the controller", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 3, question: "Some question", choices: null, variants: [] },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    expect(prisma.translation.deleteMany).not.toHaveBeenCalled();
  });

  it("does not write any translations in dry-run mode", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 4, question: "Question", choices: null, variants: [] },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: true,
    });

    expect(
      translationService.translateContentToLanguages,
    ).not.toHaveBeenCalled();
    expect(translationService.translateAssignment).not.toHaveBeenCalled();
    expect(prisma.translation.deleteMany).not.toHaveBeenCalled();
  });

  it("stops translating after the maxMissing budget is exhausted", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 1, question: "Q1", choices: null, variants: [] },
      { id: 2, question: "Q2", choices: null, variants: [] },
      { id: 3, question: "Q3", choices: null, variants: [] },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
      maxMissing: 2,
    });

    expect(
      translationService.translateContentToLanguages,
    ).toHaveBeenCalledTimes(1);

    const [, , , , , , langs] =
      translationService.translateContentToLanguages.mock.calls[0];
    expect(langs).toHaveLength(2);
  });

  it("calls translateAssignment when all languages are requested", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
    });

    expect(translationService.translateAssignment).toHaveBeenCalledWith(1);
    expect(
      translationService.translateAssignmentForLanguages,
    ).not.toHaveBeenCalled();
  });

  it("calls translateAssignmentForLanguages when a subset of languages is requested", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
      languageCodes: ["es"],
    });

    expect(
      translationService.translateAssignmentForLanguages,
    ).toHaveBeenCalledWith(1, ["es"]);
    expect(translationService.translateAssignment).not.toHaveBeenCalled();
  });

  it("findMissingTranslations scans only active-version question IDs (avoids false positives from non-active questions)", async () => {
    prisma.assignment.findMany.mockResolvedValue([{ id: 1, name: "A1" }]);
    prisma.assignmentTranslation.groupBy.mockResolvedValue([
      {
        assignmentId: 1,
        _count: { languageCode: 3 },
      },
    ]);
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      name: "A1",
      currentVersion: {
        id: 100,
        questionVersions: [{ questionId: 10 }],
      },
    });
    prisma.assignmentTranslation.findMany.mockResolvedValue([
      { languageCode: "en" },
      { languageCode: "es" },
      { languageCode: "fr" },
    ]);
    prisma.question.findMany.mockImplementation((args: any) => {
      if (args?.where?.id?.in?.includes(10)) {
        return Promise.resolve([
          {
            id: 10,
            question: "Active question",
            choices: null,
            translations: [
              { languageCode: "en", variantId: null },
              { languageCode: "es", variantId: null },
              { languageCode: "fr", variantId: null },
            ],
            variants: [],
          },
        ]);
      }
      return Promise.resolve([
        {
          id: 10,
          question: "Active question",
          choices: null,
          translations: [
            { languageCode: "en", variantId: null },
            { languageCode: "es", variantId: null },
            { languageCode: "fr", variantId: null },
          ],
          variants: [],
        },
        {
          id: 11,
          question: "Legacy non-active question",
          choices: null,
          translations: [],
          variants: [],
        },
      ]);
    });

    const result = await controller.findMissingTranslations({
      includeAll: false,
      includeNames: false,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
    expect(prisma.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [10] },
        }),
      }),
    );
  });

  it("findMissingTranslations supports onlyUntranslated filter", async () => {
    prisma.assignment.findMany.mockResolvedValue([
      { id: 1, name: "Translated assignment" },
      { id: 2, name: "Untranslated assignment" },
    ]);
    prisma.assignment.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        name:
          where.id === 1 ? "Translated assignment" : "Untranslated assignment",
        currentVersion: null,
      }),
    );
    prisma.assignmentTranslation.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.assignmentId === 1
          ? [
              { languageCode: "en" },
              { languageCode: "es" },
              { languageCode: "fr" },
            ]
          : [],
      ),
    );
    prisma.question.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.assignmentId === 1
          ? [
              {
                id: 10,
                question: "Translated question",
                choices: null,
                translations: [
                  { languageCode: "en", variantId: null },
                  { languageCode: "es", variantId: null },
                  { languageCode: "fr", variantId: null },
                ],
                variants: [],
              },
            ]
          : [
              {
                id: 20,
                question: "Untranslated question",
                choices: null,
                translations: [],
                variants: [],
              },
            ],
      ),
    );

    const result = await controller.findMissingTranslations({
      includeAll: true,
      includeNames: true,
      onlyUntranslated: true,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([
      { assignmentId: 2, assignmentName: "Untranslated assignment" },
    ]);
  });

  it("findMissingTranslations paginates missing assignments when page/pageSize are provided", async () => {
    prisma.assignment.findMany.mockResolvedValue([
      { id: 1, name: "A1" },
      { id: 2, name: "A2" },
      { id: 3, name: "A3" },
    ]);
    prisma.assignment.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        name: `A${where.id}`,
        currentVersion: null,
      }),
    );
    prisma.assignmentTranslation.findMany.mockResolvedValue([]);
    prisma.question.findMany.mockResolvedValue([]);

    const result = await controller.findMissingTranslations({
      includeAll: true,
      includeNames: true,
      page: 2,
      pageSize: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ assignmentId: 2, assignmentName: "A2" }]);
    expect(result.pagination).toEqual({
      page: 2,
      pageSize: 1,
      totalItems: 3,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it("debugAssignmentScan returns translation coverage metrics", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      name: "A1",
      questionOrder: [],
      currentVersion: null,
    });
    prisma.assignmentTranslation.findMany.mockResolvedValue([
      { languageCode: "en" },
      { languageCode: "es" },
      { languageCode: "fr" },
    ]);
    prisma.question.findMany.mockResolvedValue([
      {
        id: 10,
        question: "Q1",
        choices: null,
        translations: [{ languageCode: "en", variantId: null }],
        variants: [],
      },
    ]);

    const result = await controller.debugAssignmentScan(1, {
      includeAll: true,
      languageCodes: ["en", "es", "fr"],
      maxMissingItems: 1,
    });

    expect(result.success).toBe(true);
    expect(result.data.assignmentId).toBe(1);
    expect(result.data.totalTranslatableItems).toBe(1);
    expect(result.data.expectedTranslationRows).toBe(3);
    expect(result.data.existingTranslationRows).toBe(1);
    expect(result.data.missingTranslationRows).toBe(2);
    expect(result.data.missingItemsCount).toBe(1);
    expect(result.data.missingItemsPreview).toHaveLength(1);
    expect(result.data.missingItemsTruncated).toBe(false);
  });

  it("previewSweepBatch shows fast vs deep classification for selected assignments", async () => {
    prisma.assignment.findMany.mockResolvedValue([
      { id: 30, name: "A30" },
      { id: 20, name: "A20" },
      { id: 10, name: "A10" },
    ]);
    prisma.assignmentTranslation.groupBy.mockResolvedValue([
      { assignmentId: 30, _count: { languageCode: 1 } },
      { assignmentId: 20, _count: { languageCode: 3 } },
      { assignmentId: 10, _count: { languageCode: 3 } },
    ]);
    prisma.assignment.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve({
        id: where.id,
        name: `A${where.id}`,
        questionOrder: [],
        currentVersion: null,
      }),
    );
    prisma.assignmentTranslation.findMany.mockResolvedValue([
      { languageCode: "en" },
      { languageCode: "es" },
      { languageCode: "fr" },
    ]);
    prisma.question.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(
        where.assignmentId === 20
          ? [
              {
                id: 201,
                question: "Q missing",
                choices: null,
                translations: [{ languageCode: "en", variantId: null }],
                variants: [],
              },
            ]
          : [
              {
                id: 101,
                question: "Q complete",
                choices: null,
                translations: [
                  { languageCode: "en", variantId: null },
                  { languageCode: "es", variantId: null },
                  { languageCode: "fr", variantId: null },
                ],
                variants: [],
              },
            ],
      ),
    );

    const result = await controller.previewSweepBatch({
      batchSize: 2,
      includeAll: true,
    });

    expect(result.success).toBe(true);
    expect(result.data.batch.map((assignment) => assignment.id)).toEqual([
      30, 20,
    ]);
    expect(result.data.debug.fastNeedyAssignmentIds).toContain(30);
    expect(result.data.debug.deepNeedyAssignmentIds).toContain(20);
    expect(result.data.debug.selectedBatchIds).toEqual([30, 20]);
  });

  it("findMissingTranslations requests assignments ordered by id descending", async () => {
    prisma.assignment.findMany.mockResolvedValue([]);

    const result = await controller.findMissingTranslations({
      includeAll: true,
    });

    expect(result.success).toBe(true);
    expect(prisma.assignment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { id: "desc" },
      }),
    );
  });

  it("maps active-version questions with null questionId using displayOrder and translates them", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      questionOrder: [55],
      currentVersion: {
        id: 10,
        questionVersions: [
          {
            id: 701,
            questionId: null,
            question: "Version question text",
            choices: null,
            displayOrder: 1,
          },
        ],
      },
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 55,
        question: "Base question text",
        choices: null,
        variants: [],
      },
    ]);

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
      languageCodes: ["es"],
    });

    expect(translationService.translateContentToLanguages).toHaveBeenCalled();
    const call = translationService.translateContentToLanguages.mock.calls[0];
    expect(call[1]).toBe(55);
    expect(call[3]).toBe("Version question text");
  });

  it("continues translating remaining questions when one question translation fails", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        id: 10,
        questionVersions: [
          {
            id: 801,
            questionId: 10,
            question: "Q1",
            choices: null,
            displayOrder: 1,
          },
          {
            id: 802,
            questionId: 20,
            question: "Q2",
            choices: null,
            displayOrder: 2,
          },
        ],
      },
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 10,
        question: "Q1",
        choices: null,
        displayOrder: 1,
        variants: [],
      },
      {
        id: 20,
        question: "Q2",
        choices: null,
        displayOrder: 2,
        variants: [],
      },
    ]);

    translationService.translateContentToLanguages.mockImplementation(
      (_assignmentId: number, questionId: number) => {
        if (questionId === 10) {
          return Promise.reject(new Error("Question translation failed"));
        }
        return Promise.resolve({
          success: 1,
          failure: 0,
          successfulLanguages: ["es"],
          failedLanguages: [],
        });
      },
    );

    await runFixJob({
      assignmentId: 1,
      dryRun: false,
      languageCodes: ["es"],
    });

    expect(
      translationService.translateContentToLanguages,
    ).toHaveBeenCalledTimes(2);
    expect(translationService.detectLanguage).toHaveBeenCalledWith("Q1", 1);
    expect(translationService.detectLanguage).toHaveBeenCalledWith("Q2", 1);
  });
});
