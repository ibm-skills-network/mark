/* eslint-disable */
jest.mock("src/api/assignment/attempt/helper/languages", () => ({
  getAllLanguageCodes: () => ["en"],
}));

import { Test, TestingModule } from "@nestjs/testing";
import { TranslationService } from "src/api/assignment/v2/services/translation.service";
import { PrismaService } from "src/database/prisma.service";
import { TranslationMaintenanceController } from "./translation-maintenance.controller";

describe("TranslationMaintenanceController", () => {
  let controller: TranslationMaintenanceController;
  let prisma: {
    assignment: { findUnique: jest.Mock };
    question: { findMany: jest.Mock };
    translation: { deleteMany: jest.Mock };
  };
  let translationService: {
    translateAssignment: jest.Mock;
    translateAssignmentForLanguages: jest.Mock;
    detectLanguage: jest.Mock;
    translateContentToLanguages: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      assignment: { findUnique: jest.fn() },
      question: { findMany: jest.fn() },
      translation: { deleteMany: jest.fn() },
    };

    translationService = {
      translateAssignment: jest.fn(),
      translateAssignmentForLanguages: jest.fn(),
      detectLanguage: jest.fn().mockResolvedValue("en"),
      translateContentToLanguages: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TranslationMaintenanceController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: TranslationService, useValue: translationService },
      ],
    }).compile();

    controller = module.get<TranslationMaintenanceController>(
      TranslationMaintenanceController,
    );
  });

  it("uses latest assignment version when translating questions", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        questionVersions: [
          {
            questionId: 10,
            question: "Old question",
            type: "MULTIPLE_CHOICE",
            totalPoints: 1,
            gradingContextQuestionIds: [],
          },
        ],
      },
      versions: [
        {
          questionVersions: [
            {
              questionId: 20,
              question: "Latest question",
              type: "MULTIPLE_CHOICE",
              totalPoints: 1,
              gradingContextQuestionIds: [],
            },
          ],
        },
      ],
    });

    prisma.question.findMany.mockResolvedValue([
      {
        id: 20,
        variants: [],
      },
    ]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
      maxMissing: 1,
    });

    expect(prisma.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [20] } },
      }),
    );

    expect(translationService.detectLanguage).toHaveBeenCalledWith(
      "Latest question",
      1,
    );
  });

  it("translates questions even when base question record is missing", async () => {
    prisma.assignment.findUnique.mockResolvedValue({
      id: 1,
      currentVersion: {
        questionVersions: [
          {
            questionId: 1,
            question: "Current question",
            type: "MULTIPLE_CHOICE",
            totalPoints: 1,
            gradingContextQuestionIds: [],
          },
        ],
      },
      versions: [
        {
          questionVersions: [
            {
              questionId: 999,
              question: "Version-only question",
              type: "MULTIPLE_CHOICE",
              totalPoints: 1,
              gradingContextQuestionIds: [],
              choices: [],
            },
          ],
        },
      ],
    });

    prisma.question.findMany.mockResolvedValue([]);

    await controller.fixMissingTranslations({
      assignmentId: 1,
      dryRun: false,
      maxMissing: 1,
    });

    const [
      assignmentId,
      questionId,
      variantId,
      text,
      choices,
      sourceLanguage,
      targetLanguages,
    ] = translationService.translateContentToLanguages.mock.calls[0];

    expect(assignmentId).toBe(1);
    expect(questionId).toBe(999);
    expect(variantId).toBeNull();
    expect(text).toBe("Version-only question");
    expect(choices).toEqual([]);
    expect(sourceLanguage).toBe("en");
    expect(targetLanguages).toHaveLength(1);
  });
});
