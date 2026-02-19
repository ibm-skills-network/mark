/* eslint-disable */
jest.mock("src/api/assignment/attempt/helper/languages", () => ({
  getAllLanguageCodes: () => ["en", "es", "fr"],
}));

import { Test, TestingModule } from "@nestjs/testing";
import { JobStatusServiceV2 } from "src/api/assignment/v2/services/job-status.service";
import { TranslationService } from "src/api/assignment/v2/services/translation.service";
import { PrismaService } from "src/database/prisma.service";
import { TranslationMaintenanceController } from "./translation-maintenance.controller";

/** Drain the microtask queue repeatedly to let background async work complete */
const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
const drainAsync = async (rounds = 15) => {
  for (let i = 0; i < rounds; i++) {
    await flushPromises();
  }
};

describe("TranslationMaintenanceController", () => {
  let controller: TranslationMaintenanceController;
  let prisma: {
    assignment: { findUnique: jest.Mock };
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

  beforeEach(async () => {
    prisma = {
      assignment: { findUnique: jest.fn() },
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
        .mockResolvedValue({ success: 1, failure: 0 }),
    };

    jobStatusService = {
      createPublishJob: jest.fn().mockResolvedValue({ id: 42 }),
      updateJobStatus: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranslationMaintenanceController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: TranslationService, useValue: translationService },
        { provide: JobStatusServiceV2, useValue: jobStatusService },
      ],
    }).compile();

    controller = module.get<TranslationMaintenanceController>(
      TranslationMaintenanceController,
    );
  });

  // ---------------------------------------------------------------------------
  // Async job handoff
  // ---------------------------------------------------------------------------

  it("returns a job ID immediately without waiting for translations", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    const result = await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.jobId).toBe(42);
    expect(typeof result.message).toBe("string");
    expect(result.assignmentIds).toEqual([1]);
  });

  it("marks the job as Completed after all translations finish", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    const completedCall = jobStatusService.updateJobStatus.mock.calls.find(
      ([, update]) => update.status === "Completed",
    );
    expect(completedCall).toBeDefined();
    expect(completedCall[0]).toBe(42);
  });

  // ---------------------------------------------------------------------------
  // Version selection — must use currentVersion (active), not latest draft
  // ---------------------------------------------------------------------------

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    expect(translationService.detectLanguage).toHaveBeenCalledWith(
      "Active version question",
      1,
    );
  });

  it("falls back to base questions when there is no active version", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null, // No active version
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 99,
        question: "Base question text",
        choices: null,
        variants: [],
      },
    ]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    expect(translationService.detectLanguage).toHaveBeenCalledWith(
      "Base question text",
      1,
    );
  });

  // ---------------------------------------------------------------------------
  // Target language scoping — must always respect languageCodes filter
  // ---------------------------------------------------------------------------

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      languageCodes: ["es"],
      dryRun: false,
    });

    await drainAsync();

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    const [, , , , , , targetLanguages] =
      translationService.translateContentToLanguages.mock.calls[0];
    // getAllLanguageCodes mock returns ["en", "es", "fr"]
    expect(targetLanguages).toEqual(["en", "es", "fr"]);
  });

  // ---------------------------------------------------------------------------
  // Choices and variants
  // ---------------------------------------------------------------------------

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    // Should have been called twice: once for the question, once for the variant
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

  // ---------------------------------------------------------------------------
  // Stale translation cleanup
  // ---------------------------------------------------------------------------

  it("deletes existing translations before writing to prevent duplicate rows", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 3, question: "Some question", choices: null, variants: [] },
    ]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
    });

    await drainAsync();

    expect(prisma.translation.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ questionId: 3, variantId: null }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Dry-run mode
  // ---------------------------------------------------------------------------

  it("does not write any translations in dry-run mode", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([
      { id: 4, question: "Question", choices: null, variants: [] },
    ]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: true,
    });

    await drainAsync();

    expect(
      translationService.translateContentToLanguages,
    ).not.toHaveBeenCalled();
    expect(translationService.translateAssignment).not.toHaveBeenCalled();
    expect(prisma.translation.deleteMany).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // maxMissing budget
  // ---------------------------------------------------------------------------

  it("stops translating after the maxMissing budget is exhausted", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    // 3 questions — but maxMissing=2 (en+es for question 1 fills budget; fr never reached)
    prisma.question.findMany.mockResolvedValue([
      { id: 1, question: "Q1", choices: null, variants: [] },
      { id: 2, question: "Q2", choices: null, variants: [] },
      { id: 3, question: "Q3", choices: null, variants: [] },
    ]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
      maxMissing: 2,
    });

    await drainAsync();

    // translateContentToLanguages should only be called once (for Q1, 2 langs)
    expect(
      translationService.translateContentToLanguages,
    ).toHaveBeenCalledTimes(1);

    const [, , , , , , langs] =
      translationService.translateContentToLanguages.mock.calls[0];
    expect(langs).toHaveLength(2); // en + es (budget = 2)
  });

  // ---------------------------------------------------------------------------
  // Assignment metadata
  // ---------------------------------------------------------------------------

  it("calls translateAssignment when all languages are requested", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: null,
    });
    prisma.question.findMany.mockResolvedValue([]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
      // No languageCodes filter → all languages
    });

    await drainAsync();

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

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
      languageCodes: ["es"],
    });

    await drainAsync();

    expect(
      translationService.translateAssignmentForLanguages,
    ).toHaveBeenCalledWith(1, ["es"]);
    expect(translationService.translateAssignment).not.toHaveBeenCalled();
  });
});
