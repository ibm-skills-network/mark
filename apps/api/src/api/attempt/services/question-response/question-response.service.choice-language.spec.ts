/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { ChoiceGradingStrategy } from "../../common/strategies/choice-grading.strategy";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";
import { QuestionResponseService } from "./question-response.service";

/**
 * End to end through the grading entry point with the stored shapes seen in
 * production: Question.choices double-encoded, Translation.untranslatedChoices
 * as a JSON string, translatedChoices as an array.
 */

const authored = [
  { choice: "A normal transaction", points: 0, isCorrect: false },
  { choice: "A data entry error", points: 0, isCorrect: false },
  { choice: "A potential anomaly", points: 1, isCorrect: true },
  { choice: "A delivery delay issue", points: 0, isCorrect: false },
];
const zhCN = [
  { choice: "正常交易", points: 0, isCorrect: false },
  { choice: "数据输入错误", points: 0, isCorrect: false },
  { choice: "潜在的异常", points: 1, isCorrect: true },
  { choice: "交付延迟问题", points: 0, isCorrect: false },
];
const variantChoices = [
  { choice: "An unusual pattern", points: 1, isCorrect: true },
  { choice: "An input mistake", points: 0, isCorrect: false },
  { choice: "A routine order", points: 0, isCorrect: false },
  { choice: "A shipping delay", points: 0, isCorrect: false },
];

describe("QuestionResponseService — choices submitted in another language", () => {
  let service: QuestionResponseService;
  let strategy: ChoiceGradingStrategy;

  const childLogger = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  const mockLogger = { child: jest.fn().mockReturnValue(childLogger) };

  const prisma = {
    question: { findUnique: jest.fn() },
    assignmentAttemptQuestionVariant: { findUnique: jest.fn() },
    translation: { findMany: jest.fn() },
  };

  const translationRows = [
    {
      languageCode: "zh-CN",
      variantId: null,
      translatedChoices: zhCN,
      untranslatedChoices: JSON.stringify(authored),
    },
  ];

  const grade = (
    question: Record<string, unknown>,
    learnerChoices: string[],
    language: string,
    role = UserRole.LEARNER,
  ) =>
    (
      service as unknown as {
        gradeQuestionNoSave: (...args: unknown[]) => Promise<{
          learnerResponse: unknown;
          responseDto: { totalPoints: number; metadata?: any };
        }>;
      }
    ).gradeQuestionNoSave(
      question,
      { id: 7463, learnerChoices, language },
      { assignmentInstructions: "", questionAnswerContext: [] },
      2532,
      language,
      role,
      1697682,
    );

  beforeEach(async () => {
    jest.clearAllMocks();
    const strategyModule: TestingModule = await Test.createTestingModule({
      providers: [
        ChoiceGradingStrategy,
        {
          provide: LocalizationService,
          useValue: { getLocalizedString: jest.fn((key: string) => key) },
        },
        {
          provide: GRADING_AUDIT_SERVICE,
          useValue: { recordGrading: jest.fn() },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();
    strategy = strategyModule.get(ChoiceGradingStrategy);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: prisma },
        { provide: QuestionService, useValue: { findOne: jest.fn() } },
        {
          provide: LocalizationService,
          useValue: { getLocalizedString: jest.fn((key: string) => key) },
        },
        {
          provide: GradingFactoryService,
          useValue: { getStrategy: jest.fn(() => strategy) },
        },
        {
          provide: GradingRateLimiterService,
          useValue: {
            schedule: jest.fn(async (_n: string, op: () => any) => op()),
          },
        },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();
    service = module.get(QuestionResponseService);

    prisma.question.findUnique.mockResolvedValue({
      choices: JSON.stringify(JSON.stringify(authored)),
    });
    prisma.assignmentAttemptQuestionVariant.findUnique.mockResolvedValue({
      questionVariant: null,
    });
    prisma.translation.findMany.mockResolvedValue(translationRows);
  });

  const baseQuestion = (choices: unknown) => ({
    id: 7463,
    type: QuestionType.SINGLE_CORRECT,
    responseType: "OTHER",
    question: "q",
    totalPoints: 1,
    choices,
  });

  it("grades a zh-CN attempt that submitted the authored English text", async () => {
    const { responseDto } = await grade(
      baseQuestion(zhCN),
      ["A potential anomaly"],
      "zh-CN",
    );

    expect(responseDto.totalPoints).toBe(1);
    expect(responseDto.metadata.isCorrect).toBe(true);
  });

  it("grades an English attempt that submitted the zh-CN text", async () => {
    const { responseDto } = await grade(
      baseQuestion(authored),
      ["潜在的异常"],
      "en",
    );

    expect(responseDto.totalPoints).toBe(1);
  });

  it("grades a variant attempt shown the base question's translation by that translation's answer key", async () => {
    prisma.assignmentAttemptQuestionVariant.findUnique.mockResolvedValue({
      questionVariant: { id: 1778, choices: JSON.stringify(variantChoices) },
    });

    const { responseDto } = await grade(
      baseQuestion(variantChoices),
      ["潜在的异常"],
      "en",
    );

    expect(responseDto.totalPoints).toBe(1);
    expect(prisma.translation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          questionId: 7463,
          OR: [{ variantId: null }, { variantId: 1778 }],
        },
      }),
    );
  });

  it("reads nothing extra when the choice is in the grading language", async () => {
    const { responseDto } = await grade(
      baseQuestion(authored),
      ["A potential anomaly"],
      "en",
    );

    expect(responseDto.totalPoints).toBe(1);
    expect(prisma.translation.findMany).not.toHaveBeenCalled();
    expect(prisma.question.findUnique).not.toHaveBeenCalled();
  });

  it("does not consult stored translations for author preview", async () => {
    const { responseDto } = await grade(
      baseQuestion(authored),
      ["潜在的异常"],
      "en",
      UserRole.AUTHOR,
    );

    expect(responseDto.totalPoints).toBe(0);
    expect(prisma.translation.findMany).not.toHaveBeenCalled();
  });
});
