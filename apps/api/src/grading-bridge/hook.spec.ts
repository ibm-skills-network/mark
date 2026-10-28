import { BadRequestException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import type { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import type { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionService } from "src/api/assignment/question/question.service";
import { LocalizationService } from "src/api/attempt/common/utils/localization.service";
import { GradingFactoryService } from "src/api/attempt/services/grading-factory.service";
import { GradingRateLimiterService } from "src/api/attempt/services/grading-rate-limiter.service";
import { QuestionResponseService } from "src/api/attempt/services/question-response/question-response.service";
import { S3Service } from "src/api/files/services/s3.service";
import { OversizedSubmissionError } from "src/api/llm/features/grading/errors/oversized-submission.error";
import { RetryableProcessingError } from "src/api/llm/features/grading/errors/source-processing.error";
import { UserRole } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import type { GradingFailure, GradingOutcome } from "../v3/grading/contracts";
import { GradingModeService, type ResolvedMode } from "../v3/grading/mode";
import { V3GradingService } from "../v3/grading/v3-grading.service";
import { GradingBridgeService, V3GradingFailedError } from "./hook";

type GradeResult = {
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
};

const childLogger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};
const loggerProvider = {
  provide: WINSTON_MODULE_PROVIDER,
  useValue: { child: jest.fn(() => childLogger) },
};

const question = {
  id: 77,
  type: QuestionType.TEXT,
  question: "<p>What is 6 times 7?</p>",
  totalPoints: 4,
  scoring: JSON.stringify({
    type: "CRITERIA_BASED",
    rubrics: [
      {
        rubricQuestion: "Correct answer",
        criteria: [
          { description: "Wrong", points: 0 },
          { description: "Right", points: 4 },
        ],
      },
    ],
  }),
} as unknown as QuestionDto;

const request = (text: string) =>
  ({
    id: 77,
    learnerTextResponse: text,
    language: "en",
  }) as CreateQuestionResponseAttemptRequestDto;

function mode(value: ResolvedMode["mode"]): ResolvedMode {
  return { mode: value, effort: "low", source: "global", configId: 1 };
}

describe("gradeQuestionNoSave with the v3 bridge", () => {
  let service: QuestionResponseService;
  const strategy = {
    validateResponse: jest.fn(),
    extractLearnerResponse: jest.fn(),
    gradeResponse: jest.fn(),
  };
  const bridge = {
    resolveMode: jest.fn(),
    gradeLive: jest.fn(),
    runShadow: jest.fn(),
  };
  const legacyDto = { totalPoints: 3, feedback: [{ feedback: "legacy" }] };

  async function build(withBridge: boolean) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionResponseService,
        { provide: PrismaService, useValue: {} },
        { provide: QuestionService, useValue: {} },
        {
          provide: LocalizationService,
          useValue: { getLocalizedString: jest.fn(() => "x") },
        },
        {
          provide: GradingFactoryService,
          useValue: { getStrategy: jest.fn(() => strategy) },
        },
        {
          provide: GradingRateLimiterService,
          useValue: { schedule: jest.fn() },
        },
        loggerProvider,
        { provide: "GradingProgressService", useValue: undefined },
        ...(withBridge
          ? [{ provide: GradingBridgeService, useValue: bridge }]
          : []),
      ],
    }).compile();
    service = module.get(QuestionResponseService);
  }

  const grade = (
    role: UserRole = UserRole.LEARNER,
    sourceCheckOnly = false,
  ): Promise<GradeResult> =>
    (
      service as unknown as {
        gradeQuestionNoSave: (...args: unknown[]) => Promise<GradeResult>;
      }
    ).gradeQuestionNoSave(
      question,
      request("It is 42"),
      { assignmentInstructions: "", questionAnswerContext: [] },
      12,
      "en",
      role,
      345,
      "learner@example.com",
      sourceCheckOnly,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    strategy.validateResponse.mockResolvedValue(true);
    strategy.extractLearnerResponse.mockResolvedValue("It is 42");
    strategy.gradeResponse.mockResolvedValue(legacyDto);
    bridge.runShadow.mockResolvedValue(undefined);
  });

  it("without a bridge, grades with legacy", async () => {
    await build(false);
    const result = await grade();
    expect(result.responseDto).toBe(legacyDto);
  });

  it("off: legacy grades exactly as before and v3 is never called", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("off"));
    const result = await grade();
    expect(bridge.resolveMode).toHaveBeenCalledWith(
      question,
      12,
      UserRole.LEARNER,
    );
    expect(result).toEqual({
      learnerResponse: "It is 42",
      responseDto: legacyDto,
    });
    expect(strategy.gradeResponse).toHaveBeenCalledTimes(1);
    expect(bridge.gradeLive).not.toHaveBeenCalled();
    expect(bridge.runShadow).not.toHaveBeenCalled();
  });

  it("live: v3 grades and legacy grading is not called", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("live"));
    const v3Dto = { totalPoints: 4, feedback: [{ feedback: "v3" }] };
    bridge.gradeLive.mockResolvedValue({
      learnerResponse: "It is 42",
      responseDto: v3Dto,
    });
    const result = await grade();
    expect(result.responseDto).toBe(v3Dto);
    expect(strategy.gradeResponse).not.toHaveBeenCalled();
  });

  it("live: a v3 failure goes down the legacy failure path, with no fallback", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("live"));
    bridge.gradeLive.mockRejectedValue(
      new V3GradingFailedError("grading.v3.check_failed"),
    );
    await expect(grade()).rejects.toBeInstanceOf(BadRequestException);
    expect(strategy.gradeResponse).not.toHaveBeenCalled();
  });

  it("live: a retryable v3 failure keeps its class for the job retry logic", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("live"));
    bridge.gradeLive.mockRejectedValue(
      new RetryableProcessingError("grading_unavailable"),
    );
    await expect(grade()).rejects.toBeInstanceOf(RetryableProcessingError);
  });

  it("live: a source-check-only pass does no model work", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("live"));
    const result = await grade(UserRole.LEARNER, true);
    expect(result.learnerResponse).toBeUndefined();
    expect(bridge.gradeLive).not.toHaveBeenCalled();
  });

  it("shadow: legacy's grade is returned and v3 only gets a copy to compare", async () => {
    await build(true);
    bridge.resolveMode.mockResolvedValue(mode("shadow"));
    const result = await grade();
    expect(result.responseDto).toBe(legacyDto);
    expect(bridge.runShadow).toHaveBeenCalledWith(
      question,
      { learnerResponse: "It is 42", responseDto: legacyDto },
      expect.objectContaining({ assignmentId: 12, attemptId: 345 }),
      mode("shadow"),
    );
  });
});

describe("GradingBridgeService", () => {
  let bridge: GradingBridgeService;
  const modes = { resolve: jest.fn() };
  const grader = { grade: jest.fn() };
  const strategy = {
    validateResponse: jest.fn(),
    extractLearnerResponse: jest.fn(),
    gradeResponse: jest.fn(),
  };
  const factory = { getStrategy: jest.fn(() => strategy) };
  const s3 = { getObject: jest.fn() };
  const context = { assignmentId: 12, attemptId: 345 } as never;

  beforeEach(async () => {
    jest.clearAllMocks();
    strategy.validateResponse.mockResolvedValue(true);
    strategy.extractLearnerResponse.mockResolvedValue("<p>It is <b>42</b></p>");
    const module = await Test.createTestingModule({
      providers: [
        GradingBridgeService,
        { provide: GradingModeService, useValue: modes },
        { provide: V3GradingService, useValue: grader },
        { provide: GradingFactoryService, useValue: factory },
        { provide: S3Service, useValue: s3 },
        loggerProvider,
      ],
    }).compile();
    bridge = module.get(GradingBridgeService);
  });

  function failed(partial: Partial<GradingFailure>): GradingOutcome {
    return {
      status: "failed",
      failure: {
        code: "grading.v3.check_failed",
        message: "x",
        retryable: false,
        checkFailures: [],
        usage: {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
        },
        model: undefined,
        effort: "low",
        promptVersion: "grade.v1",
        ...partial,
      },
    };
  }

  it("keeps author previews on legacy", async () => {
    await expect(
      bridge.resolveMode(question, 12, UserRole.AUTHOR),
    ).resolves.toEqual(expect.objectContaining({ mode: "off" }));
    expect(modes.resolve).not.toHaveBeenCalled();
  });

  it("keeps media response types on legacy and logs it", async () => {
    modes.resolve.mockResolvedValue(mode("live"));
    const media = {
      ...question,
      type: QuestionType.UPLOAD,
      responseType: "VIDEO",
    } as unknown as QuestionDto;
    await expect(
      bridge.resolveMode(media, 12, UserRole.LEARNER),
    ).resolves.toEqual(expect.objectContaining({ mode: "off" }));
    expect(childLogger.info).toHaveBeenCalledWith(
      "grading.mode.format_not_ready",
      expect.any(Object),
    );
  });

  it("live: builds the input from the legacy question, stored as legacy stores it", async () => {
    grader.grade.mockResolvedValue({
      status: "graded",
      result: {
        verdicts: [
          {
            criterionId: "c1",
            points: 4,
            reason: "r",
            quotes: [{ part: "answer", text: "42" }],
            feedback: "Right.",
          },
        ],
        totalPoints: 4,
        overallFeedback: "Well done.",
        usage: {
          inputTokens: 10,
          cachedInputTokens: 0,
          outputTokens: 5,
          reasoningTokens: 1,
        },
        model: "gpt-6-luna",
        effort: "low",
        promptVersion: "grade.v1",
        checkFailures: [],
      },
    } satisfies GradingOutcome);

    const result = await bridge.gradeLive(
      question,
      request("<p>It is <b>42</b></p>"),
      context,
      mode("live"),
    );

    const [gradingQuestion, source, logContext] = grader.grade.mock
      .calls[0] as [
      { questionText: string; rubric: { criteria: unknown[] }; effort: string },
      { text: string },
      Record<string, unknown>,
    ];
    expect(gradingQuestion.questionText).toBe("What is 6 times 7?");
    expect(gradingQuestion.effort).toBe("low");
    expect(gradingQuestion.rubric.criteria).toEqual([
      {
        id: "c1",
        description: "Correct answer",
        maxPoints: 4,
        levels: [
          { points: 0, description: "Wrong" },
          { points: 4, description: "Right" },
        ],
      },
    ]);
    // Rich text arrives as light Markdown.
    expect(source.text).toBe("It is **42**");
    expect(logContext).toEqual(
      expect.objectContaining({ questionId: 77, attemptId: 345, mode: "live" }),
    );

    expect(result.learnerResponse).toBe("<p>It is <b>42</b></p>");
    expect(result.responseDto.totalPoints).toBe(4);
    expect(result.responseDto.metadata).toEqual(
      expect.objectContaining({
        gradingEngine: "v3",
        model: "gpt-6-luna",
        promptVersion: "grade.v1",
      }),
    );
    const feedback = result.responseDto.feedback?.[0] as {
      feedback: string;
      structuredFeedback: {
        criteria: Array<{ pointsAwarded: number; status: string }>;
      };
    };
    expect(feedback.feedback).toContain("Well done.");
    expect(feedback.structuredFeedback.criteria[0]).toEqual(
      expect.objectContaining({ pointsAwarded: 4, status: "full" }),
    );
  });

  it.each([
    [{ code: "grading.v3.check_failed" as const }, V3GradingFailedError],
    [
      { code: "grading.v3.model_unavailable" as const, retryable: true },
      RetryableProcessingError,
    ],
    [
      {
        code: "grading.v3.over_budget" as const,
        estimatedTokens: 300_000,
        tokenBudget: 150_000,
      },
      OversizedSubmissionError,
    ],
  ])(
    "live: maps failure %p to the legacy error class",
    async (failure, errorClass) => {
      grader.grade.mockResolvedValue(failed(failure));
      await expect(
        bridge.gradeLive(question, request("x"), context, mode("live")),
      ).rejects.toBeInstanceOf(errorClass);
    },
  );

  it("shadow: logs the comparison and never throws", async () => {
    grader.grade.mockRejectedValue(new Error("boom"));
    await expect(
      bridge.runShadow(
        question,
        {
          learnerResponse: "It is 42",
          responseDto: {
            totalPoints: 3,
          } as CreateQuestionResponseAttemptResponseDto,
        },
        context,
        mode("shadow"),
      ),
    ).resolves.toBeUndefined();
    expect(childLogger.error).toHaveBeenCalledWith(
      "grading.v3.shadow_failed",
      expect.any(Object),
    );
  });

  it("shadow: logs legacy and v3 points side by side", async () => {
    grader.grade.mockResolvedValue(failed({}));
    await bridge.runShadow(
      question,
      {
        learnerResponse: "It is 42",
        responseDto: {
          totalPoints: 3,
        } as CreateQuestionResponseAttemptResponseDto,
      },
      context,
      mode("shadow"),
    );
    expect(childLogger.info).toHaveBeenCalledWith(
      "grading.v3.shadow_compare",
      expect.objectContaining({
        legacyPoints: 3,
        v3Status: "failed",
        v3FailureCode: "grading.v3.check_failed",
      }),
    );
  });

  it("loads uploaded files from storage and maps a missing object like legacy", async () => {
    factory.getStrategy.mockReturnValue(strategy);
    strategy.extractLearnerResponse.mockResolvedValue([
      {
        filename: "a.txt",
        bucket: "b",
        key: "12/u/77/a.txt",
        content: "InCos",
      },
    ]);
    s3.getObject.mockRejectedValue(
      Object.assign(new Error("NoSuchKey"), {
        $metadata: { httpStatusCode: 404 },
      }),
    );
    grader.grade.mockImplementation(
      async (
        _q: unknown,
        source: { files: Array<{ load(): Promise<Buffer> }> },
      ) => {
        await source.files[0].load();
        return failed({});
      },
    );
    const upload = {
      ...question,
      type: QuestionType.UPLOAD,
    } as unknown as QuestionDto;
    await expect(
      bridge.gradeLive(
        upload,
        { id: 77, learnerFileResponse: [] } as never,
        context,
        mode("live"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(s3.getObject).toHaveBeenCalledWith({
      Bucket: "b",
      Key: "12/u/77/a.txt",
    });
  });
});
