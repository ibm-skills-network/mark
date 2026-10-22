import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { PrismaService } from "../../../../database/prisma.service";
import { QuestionService } from "../../../assignment/question/question.service";
import { GithubRateLimitedError } from "../../../llm/features/grading/errors/github-rate-limited.error";
import {
  RetryableProcessingError,
  SourceProcessingError,
} from "../../../llm/features/grading/errors/source-processing.error";
import { UnsupportedImageFormatError } from "../../../llm/features/grading/errors/unsupported-image-format.error";
import { LocalizationService } from "../../common/utils/localization.service";
import { GradingFactoryService } from "../grading-factory.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";
import { QuestionResponseService } from "./question-response.service";

type GradeNoSaveArgs = [
  { id: number },
  unknown,
  unknown,
  number,
  string,
  string,
  number,
  string | undefined,
  boolean,
];

const QUESTIONS = [
  { id: 7921, type: QuestionType.URL, gradingContextQuestionIds: [] },
  { id: 7922, type: QuestionType.URL, gradingContextQuestionIds: [] },
  { id: 7924, type: QuestionType.UPLOAD, gradingContextQuestionIds: [] },
  { id: 7925, type: QuestionType.TEXT, gradingContextQuestionIds: [] },
];

function blockedUrl(questionId: number, url: string): SourceProcessingError {
  return new SourceProcessingError("url_fetch_failed", "url", {
    code: "url_unreachable",
    questionId,
    source: { kind: "url", url, httpStatus: 404 },
  });
}

describe("QuestionResponseService — every blocked question is reported", () => {
  let service: QuestionResponseService;
  let gradeNoSave: jest.SpyInstance;
  const childLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  // Serial limiter: queued work starts only after the previous one settles,
  // which is how a busy grading limiter behaves.
  let chain: Promise<unknown> = Promise.resolve();
  const serialLimiter = {
    parallelEnabled: false,
    schedule: jest.fn((_name: string, op: () => Promise<unknown>) => {
      const run = chain.then(op, op);
      chain = run.catch(() => undefined);
      return run;
    }),
  };

  const mockPrisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({}),
    ),
    assignment: { findUnique: jest.fn().mockResolvedValue(null) },
    question: { findMany: jest.fn().mockResolvedValue([]) },
  };

  beforeEach(async () => {
    chain = Promise.resolve();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QuestionService, useValue: {} },
        { provide: LocalizationService, useValue: {} },
        { provide: GradingFactoryService, useValue: {} },
        { provide: GradingRateLimiterService, useValue: serialLimiter },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { child: () => childLogger },
        },
        {
          provide: "GradingProgressService",
          useValue: {
            initializeProgress: jest.fn(),
            updateQuestionProgress: jest.fn(),
            setQuestionStatus: jest.fn(),
            initializeQuestions: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(QuestionResponseService);
    jest.clearAllMocks();

    const internals = service as unknown as Record<string, unknown>;
    jest
      .spyOn(internals as never, "getLearnerQuestion" as never)
      .mockImplementation((async (id: number) => ({
        question: QUESTIONS.find((q) => q.id === id),
      })) as never);
    jest
      .spyOn(internals as never, "getAssignmentContext" as never)
      .mockResolvedValue({
        assignmentInstructions: "",
        questionAnswerContext: [],
      } as never);
    gradeNoSave = jest.spyOn(
      internals as never,
      "gradeQuestionNoSave" as never,
    );
  });

  function grade() {
    return service.gradeQuestionsForLearner(
      QUESTIONS.map((q) => ({ id: q.id })) as never,
      1877436,
      2561,
      "en",
    );
  }

  function sourceCheckFlags(): Record<number, boolean> {
    return Object.fromEntries(
      (gradeNoSave.mock.calls as GradeNoSaveArgs[]).map((args) => [
        args[0].id,
        args[8],
      ]),
    );
  }

  it("reports two blocked questions together, in question order", async () => {
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7921) {
        throw blockedUrl(
          7921,
          "https://github.com/Blaziton456/e-plantScience/blob/main/README.md",
        );
      }
      if (question.id === 7924) {
        throw new UnsupportedImageFormatError({
          filename: "Packet capture.pcapng.png",
          detectedFormat: "unknown",
          reason: "unrecognized data",
        });
      }
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    const error = await grade().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SourceProcessingError);
    const { issues } = error as SourceProcessingError;
    expect(issues.map((issue) => [issue.questionId, issue.code])).toEqual([
      [7921, "url_unreachable"],
      [7924, "file_unsupported_type"],
    ]);
    expect(issues[1]).toMatchObject({
      retryable: false,
      source: { kind: "file", fileName: "Packet capture.pcapng.png" },
    });
    expect((error as SourceProcessingError).message).toMatch(
      /couldn't grade 2 of your answers/,
    );
    expect(childLogger.warn).toHaveBeenCalledWith(
      "grading.unable_to_grade.issue",
      expect.objectContaining({
        attemptId: 1877436,
        assignmentId: 2561,
        questionId: 7921,
        code: "url_unreachable",
        host: "github.com",
        httpStatus: 404,
      }),
    );
  });

  it("checks only sources, with no model work, for questions started after a block", async () => {
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7921)
        throw blockedUrl(7921, "https://github.com/a/b");
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    await expect(grade()).rejects.toBeInstanceOf(SourceProcessingError);

    expect(sourceCheckFlags()).toEqual({
      7921: false,
      7922: true,
      7924: true,
      7925: true,
    });
  });

  it("finishes a question that was already grading when another one blocked", async () => {
    let releaseFirst: () => void = () => undefined;
    const parallel = {
      parallelEnabled: true,
      schedule: (_name: string, op: () => Promise<unknown>) => op(),
    };
    (service as unknown as { rateLimiter: unknown }).rateLimiter = parallel;
    const completed: number[] = [];
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7921) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        completed.push(7921);
        return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
      }
      if (question.id === 7922) {
        setTimeout(() => releaseFirst(), 0);
        throw blockedUrl(7922, "https://github.com/a/b");
      }
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    await expect(grade()).rejects.toMatchObject({
      issues: [expect.objectContaining({ questionId: 7922 })],
    });
    expect(completed).toEqual([7921]);
  });

  it("lists a transient link failure alongside fixable problems", async () => {
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7921)
        throw blockedUrl(7921, "https://github.com/a/b");
      if (question.id === 7922) {
        const transient = new GithubRateLimitedError({
          owner: "a",
          repo: "c",
          requestUrl: "https://api.github.com/repos/a/c",
        });
        transient.questionId = 7922;
        transient.learnerUrl = "https://github.com/a/c";
        throw transient;
      }
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    const error = (await grade().catch(
      (caught: unknown) => caught,
    )) as SourceProcessingError;

    expect(error.issues).toEqual([
      expect.objectContaining({ questionId: 7921, retryable: false }),
      expect.objectContaining({
        questionId: 7922,
        code: "url_temporarily_unavailable",
        retryable: true,
        source: { kind: "url", url: "https://github.com/a/c" },
      }),
    ]);
  });

  it("rethrows a transient-only failure so the queue retries it", async () => {
    const transient = new RetryableProcessingError("grading_unavailable");
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7922) throw transient;
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    await expect(grade()).rejects.toBe(transient);
  });

  it("rethrows our own failure untouched when nothing is learner-fixable", async () => {
    const bug = new TypeError("cannot read properties of undefined");
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7925) throw bug;
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    await expect(grade()).rejects.toBe(bug);
    expect(childLogger.error).toHaveBeenCalledWith(
      "grading.wave.question.failed",
      expect.objectContaining({ questionId: 7925, stack: expect.any(String) }),
    );
  });

  it("still reports fixable problems when one of our failures happened too", async () => {
    gradeNoSave.mockImplementation((async (question: { id: number }) => {
      if (question.id === 7921)
        throw blockedUrl(7921, "https://github.com/a/b");
      if (question.id === 7925) throw new TypeError("boom");
      return { learnerResponse: "x", responseDto: { totalPoints: 1 } };
    }) as never);

    await expect(grade()).rejects.toMatchObject({
      name: "SourceProcessingError",
      issues: [expect.objectContaining({ questionId: 7921 })],
    });
    expect(childLogger.error).toHaveBeenCalledWith(
      "grading.unable_to_grade.with_unexpected_failure",
      expect.objectContaining({ attemptId: 1877436 }),
    );
  });
});
