/* eslint-disable */
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { GithubRateLimitedError } from "src/api/llm/features/grading/errors/github-rate-limited.error";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";
import * as githubContentFetch from "src/api/attempt/common/utils/github-content-fetch.util";
import { QuestionResponseService } from "./question-response.service";

jest.mock("src/api/attempt/common/utils/github-content-fetch.util");

const mockedFetch =
  githubContentFetch.fetchUrlContentForGrading as jest.MockedFunction<
    typeof githubContentFetch.fetchUrlContentForGrading
  >;
const mockedConvert =
  githubContentFetch.convertGitHubUrlToRaw as jest.MockedFunction<
    typeof githubContentFetch.convertGitHubUrlToRaw
  >;

const mockRateLimiter = {
  schedule: jest.fn(async (_name: string, op: () => Promise<any>) => op()),
};

describe("QuestionResponseService URL-fetch delegation", () => {
  let service: QuestionResponseService;

  const mockPrisma = {
    assignment: { findUnique: jest.fn() },
    question: { findUnique: jest.fn(), findMany: jest.fn() },
    questionResponse: { findMany: jest.fn() },
  };
  const mockQuestionService = { findOne: jest.fn() };
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
        { provide: GradingRateLimiterService, useValue: mockRateLimiter },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        { provide: "GradingProgressService", useValue: undefined },
      ],
    }).compile();

    service = module.get<QuestionResponseService>(QuestionResponseService);
    jest.clearAllMocks();
    mockedFetch.mockReset();
    mockedConvert.mockReset();
  });

  it("delegates blob-URL rewriting in handleLinkFileQuestion to the shared convertGitHubUrlToRaw", async () => {
    // handleLinkFileQuestion is private; call it the same way the existing
    // suite exercises other private methods on this service.
    mockedConvert.mockReturnValue(
      "https://raw.githubusercontent.com/octocat/hello-world/main/index.js",
    );

    // Minimal stub grading strategy so the call proceeds past the rewrite.
    const urlGradingStrategy = {
      validateResponse: jest.fn().mockResolvedValue(true),
      extractLearnerResponse: jest.fn().mockResolvedValue("rewritten"),
      gradeResponse: jest
        .fn()
        .mockResolvedValue({ totalPoints: 5, feedback: [] }),
    };
    (service as any).gradingFactoryService = {
      getStrategy: jest.fn().mockReturnValue(urlGradingStrategy),
    };

    const question = { id: 1, type: QuestionType.LINK_FILE, totalPoints: 5 };
    const requestDto: any = {
      learnerUrlResponse:
        "https://github.com/octocat/hello-world/blob/main/index.js",
      language: "en",
    };

    await (service as any).handleLinkFileQuestion(question, requestDto, {});

    expect(mockedConvert).toHaveBeenCalledWith(
      "https://github.com/octocat/hello-world/blob/main/index.js",
    );
  });

  it("delegates context-building URL fetches to the shared helper and still swallows failures", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({ instructions: "" });
    mockPrisma.question.findUnique.mockResolvedValue({
      gradingContextQuestionIds: [30],
    });
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 30, question: "Link your repo", type: QuestionType.URL },
    ]);
    mockPrisma.questionResponse.findMany.mockResolvedValue([
      {
        questionId: 30,
        learnerResponse: "https://github.com/octocat/hello-world",
      },
    ]);
    mockedFetch.mockResolvedValue({ body: "# Readme", isFunctional: true });

    const ctx = await (service as any).getAssignmentContext(
      5,
      20,
      10,
      undefined,
      new Map(),
    );

    expect(mockedFetch).toHaveBeenCalledWith(
      "https://github.com/octocat/hello-world",
      expect.objectContaining({ assignmentId: 5, questionId: 30 }),
    );
    expect(ctx.questionAnswerContext[0].answer).toContain("# Readme");
  });

  it("still ignores a rate-limit failure while building context (does not throw)", async () => {
    mockPrisma.assignment.findUnique.mockResolvedValue({ instructions: "" });
    mockPrisma.question.findUnique.mockResolvedValue({
      gradingContextQuestionIds: [30],
    });
    mockPrisma.question.findMany.mockResolvedValue([
      { id: 30, question: "Link your repo", type: QuestionType.URL },
    ]);
    mockPrisma.questionResponse.findMany.mockResolvedValue([
      {
        questionId: 30,
        learnerResponse: "https://github.com/octocat/hello-world",
      },
    ]);
    mockedFetch.mockRejectedValue(
      new GithubRateLimitedError({
        owner: "octocat",
        repo: "hello-world",
        requestUrl: "https://api.github.com/repos/octocat/hello-world",
      }),
    );

    await expect(
      (service as any).getAssignmentContext(5, 20, 10, undefined, new Map()),
    ).resolves.toBeDefined();
  });
});
