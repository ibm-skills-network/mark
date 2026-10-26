import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { questionDtoFromVersion } from "../../common/utils/grading-question-source.util";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "src/api/assignment/question/question.service";
import { TranslationService } from "./translation.service";

const mockPrismaService = {
  translation: {
    findMany: jest.fn(),
  },
};

const mockQuestionService = {
  findOne: jest.fn(),
};

const baseAttempt = {
  id: 71,
  assignmentId: 99,
  questionVariants: [],
} as unknown as Parameters<TranslationService["getTranslationsForAttempt"]>[0];

const questions = [
  {
    id: 7,
    question: "Pick one",
    choices: [{ choice: "A", isCorrect: true, points: 1 }],
  },
] as unknown as Parameters<TranslationService["getTranslationsForAttempt"]>[1];

describe("TranslationService.getTranslationsForAttempt", () => {
  let service: TranslationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QuestionService, useValue: mockQuestionService },
      ],
    }).compile();

    service = module.get<TranslationService>(TranslationService);
  });

  // The learner response embedded every language's translation of every
  // question. Where question HTML carries inline images that multiplies each
  // image by the number of languages an assignment has been translated into —
  // an 8-question assignment with 23 languages served a 4.6 MB attempt, the
  // same size no matter which language was asked for.
  it("reads only the requested language family", async () => {
    mockPrismaService.translation.findMany.mockResolvedValue([]);

    await service.getTranslationsForAttempt(baseAttempt, questions, "de");

    expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          languageCode: { startsWith: "de", mode: "insensitive" },
        }),
      }),
    );
  });

  it("drops rows whose family only shares the prefix, in id order", async () => {
    mockPrismaService.translation.findMany.mockResolvedValue([
      {
        questionId: 7,
        variantId: null,
        languageCode: "fr",
        translatedText: "Choisissez",
        translatedChoices: null,
      },
      {
        questionId: 7,
        variantId: null,
        languageCode: "fry",
        translatedText: "Frisian",
        translatedChoices: null,
      },
      {
        questionId: 7,
        variantId: null,
        languageCode: "FR-ca",
        translatedText: "Choisis",
        translatedChoices: null,
      },
    ]);

    const result = await service.getTranslationsForAttempt(
      baseAttempt,
      questions,
      "fr",
    );

    expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { id: "asc" } }),
    );
    const entry = result.get("question-7") ?? {};
    expect(Object.keys(entry)).toEqual(["fr", "FR-ca", "en"]);
  });

  // Regional rows are stored under their full code (zh-CN, zh-TW, uk-UA), and
  // the client picks the entry matching its own full locale, so the family
  // prefix has to keep every regional row of the requested language.
  it("keeps regional rows of the requested language", async () => {
    mockPrismaService.translation.findMany.mockResolvedValue([
      {
        questionId: 7,
        variantId: null,
        languageCode: "zh-CN",
        translatedText: "选一个",
        translatedChoices: [{ choice: "甲" }],
      },
      {
        questionId: 7,
        variantId: null,
        languageCode: "zh-TW",
        translatedText: "選一個",
        translatedChoices: [{ choice: "甲" }],
      },
    ]);

    const result = await service.getTranslationsForAttempt(
      baseAttempt,
      questions,
      "zh-CN",
    );

    expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          languageCode: { startsWith: "zh", mode: "insensitive" },
        }),
      }),
    );
    const entry = result.get("question-7");
    expect(entry?.["zh-CN"]).toEqual(
      expect.objectContaining({ translatedText: "选一个" }),
    );
    expect(entry?.["zh-TW"]).toEqual(
      expect.objectContaining({ translatedText: "選一個" }),
    );
  });

  // The untranslated question is always added under "en" as the baseline the
  // mapper falls back to, so an English request must not widen the query.
  it("still reads only English for an English request", async () => {
    mockPrismaService.translation.findMany.mockResolvedValue([]);

    const result = await service.getTranslationsForAttempt(
      baseAttempt,
      questions,
      "en",
    );

    expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          languageCode: { startsWith: "en", mode: "insensitive" },
        }),
      }),
    );
    expect(result.get("question-7")?.en).toEqual(
      expect.objectContaining({ translatedText: "Pick one" }),
    );
  });

  it("defaults to English when no language is requested", async () => {
    mockPrismaService.translation.findMany.mockResolvedValue([]);

    await service.getTranslationsForAttempt(baseAttempt, questions);

    expect(mockPrismaService.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          languageCode: { startsWith: "en", mode: "insensitive" },
        }),
      }),
    );
  });
});

describe("TranslationService.applyTranslationToQuestion", () => {
  const findFirst = jest.fn();
  let service: TranslationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationService,
        {
          provide: PrismaService,
          useValue: { translation: { findFirst, findMany: findFirst } },
        },
        { provide: QuestionService, useValue: mockQuestionService },
      ],
    }).compile();
    service = module.get<TranslationService>(TranslationService);
  });

  it("never looks up a translation for a question built from a version row with no source question", async () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const question = questionDtoFromVersion(
      {
        id: 5001,
        assignmentVersionId: 9,
        authorComment: null,
        questionId: null,
        totalPoints: 5,
        type: QuestionType.TEXT,
        responseType: null,
        question: "Explain",
        maxWords: null,
        scoring: null,
        choices: null,
        randomizedChoices: null,
        answer: null,
        gradingContextQuestionIds: [],
        maxCharacters: null,
        videoPresentationConfig: null,
        liveRecordingConfig: null,
        displayOrder: null,
        createdAt: new Date(0),
      },
      99,
    );

    const result = await service.applyTranslationToQuestion(question, "fr");

    expect(result).toBe(question);
    expect(findFirst).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("translation.skipped_version_only_question"),
    );
    warn.mockRestore();
  });
});
