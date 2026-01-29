/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { QuestionResponseService } from "./question-response.service";

describe("QuestionResponseService", () => {
  let service: QuestionResponseService;

  const mockPrisma = {
    assignmentAttempt: {
      findUnique: jest.fn(),
    },
  };

  const mockQuestionService = {
    findOne: jest.fn(),
  };

  const mockLocalizationService = {};
  const mockGradingFactoryService = {};

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: mockQuestionService },
        { provide: LocalizationService, useValue: mockLocalizationService },
        { provide: GradingFactoryService, useValue: mockGradingFactoryService },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();
  });

  it("uses the base question id for variant questions", async () => {
    const assignmentAttempt = {
      id: 289110,
      questionVariants: [
        {
          questionId: 10383,
          questionVariant: {
            id: 2060,
            questionId: 10383,
            variantContent: "Multi-Active cultures are most likely to:",
            choices: null,
            maxWords: null,
            maxCharacters: null,
            scoring: null,
            answer: null,
            variantOf: {
              id: 10383,
              type: QuestionType.SINGLE_CORRECT,
              assignmentId: 2991,
              maxWords: null,
              maxCharacters: null,
              scoring: null,
              choices: null,
              answer: null,
              totalPoints: 1,
              responseType: "OTHER",
              gradingContextQuestionIds: [],
            },
          },
        },
      ],
    };

    mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(
      assignmentAttempt,
    );

    jest
      .spyOn(
        service as unknown as { getAssignmentContext: () => void },
        "getAssignmentContext",
      )
      .mockResolvedValue({
        assignmentInstructions: "",
        questionAnswerContext: [],
      });

    const result = await (
      service as unknown as {
        getLearnerQuestion: (
          questionId: number,
          assignmentAttemptId: number,
          assignmentId: number,
        ) => Promise<{
          question: { id: number; question: string; type: QuestionType };
        }>;
      }
    ).getLearnerQuestion(10383, 289110, 2991);

    expect(result.question.id).toBe(10383);
    expect(result.question.id).not.toBe(2060);
    expect(result.question.question).toBe(
      "Multi-Active cultures are most likely to:",
    );
    expect(result.question.type).toBe(QuestionType.SINGLE_CORRECT);
    expect(mockQuestionService.findOne).not.toHaveBeenCalled();
  });
});
