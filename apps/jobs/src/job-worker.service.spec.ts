import { Logger } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Worker } from "bullmq";
import { TRANSLATION_MAINTENANCE_JOB_RUNNER } from "../../api/src/api/admin/controllers/translation-maintenance.job-runner";
import { AssignmentServiceV1 } from "../../api/src/api/assignment/v1/services/assignment.service";
import { AssignmentServiceV2 } from "../../api/src/api/assignment/v2/services/assignment.service";
import { QuestionService } from "../../api/src/api/assignment/v2/services/question.service";
import { AttemptServiceV2 } from "../../api/src/api/attempt/services/attempt.service";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
} from "../../api/src/job-queue/job-queue.constants";
import { encryptJobPayload } from "../../api/src/job-queue/job-payload.crypto";
import { createRedisConnection } from "../../api/src/job-queue/redis.connection";
import { JobWorkerService } from "./job-worker.service";

const workerClose = jest.fn();
const workerWaitUntilReady = jest.fn();
const workerInstances: Array<{
  close: typeof workerClose;
  handlers: Partial<
    Record<"completed" | "failed", (...arguments_: any[]) => void>
  >;
  on: jest.Mock;
  options: unknown;
  processor: (job: unknown) => Promise<void>;
  queueName: string;
  waitUntilReady: typeof workerWaitUntilReady;
}> = [];

jest.mock("bullmq", () => ({
  Worker: jest
    .fn()
    .mockImplementation(
      (
        queueName: string,
        processor: (job: unknown) => Promise<void>,
        options: unknown,
      ) => {
        const handlers: Partial<
          Record<"completed" | "failed", (...arguments_: any[]) => void>
        > = {};
        const instance = {
          queueName,
          processor,
          options,
          close: workerClose,
          on: jest.fn(
            (
              event: "completed" | "failed",
              handler: (...arguments_: any[]) => void,
            ) => {
              handlers[event] = handler;
            },
          ),
          waitUntilReady: workerWaitUntilReady,
          handlers,
        };
        workerInstances.push(instance);
        return instance;
      },
    ),
}));

jest.mock("../../api/src/job-queue/redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

describe("JobWorkerService", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];
  const mockConnection = {
    quit: jest.fn(),
  };

  let moduleRef: { get: jest.Mock };
  let assignmentServiceV1: {
    runGenerateQuestionsJob: jest.Mock;
    runPublishJob: jest.Mock;
  };
  let assignmentServiceV2: { runPublishJob: jest.Mock };
  let questionService: { runQuestionGenerationJob: jest.Mock };
  let attemptService: {
    processGradingJob: jest.Mock;
    processAuthorPreviewJob: jest.Mock;
  };
  let translationRunner: {
    runFixMissingTranslationsJob: jest.Mock;
    runSweepMissingTranslationsJob: jest.Mock;
  };
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  let service: JobWorkerService;

  beforeEach(() => {
    jest.clearAllMocks();
    workerInstances.length = 0;
    logSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    process.env[jobQueueSecretEnv] = "worker-test-secret";

    workerClose.mockResolvedValue(undefined);
    workerWaitUntilReady.mockResolvedValue(undefined);
    mockConnection.quit.mockResolvedValue(undefined);
    (createRedisConnection as jest.Mock).mockReturnValue(mockConnection);

    assignmentServiceV1 = {
      runGenerateQuestionsJob: jest.fn().mockResolvedValue(undefined),
      runPublishJob: jest.fn().mockResolvedValue(undefined),
    };
    assignmentServiceV2 = {
      runPublishJob: jest.fn().mockResolvedValue(undefined),
    };
    questionService = {
      runQuestionGenerationJob: jest.fn().mockResolvedValue(undefined),
    };
    attemptService = {
      processGradingJob: jest.fn().mockResolvedValue(undefined),
      processAuthorPreviewJob: jest.fn().mockResolvedValue(undefined),
    };
    translationRunner = {
      runFixMissingTranslationsJob: jest.fn().mockResolvedValue(undefined),
      runSweepMissingTranslationsJob: jest.fn().mockResolvedValue(undefined),
    };

    moduleRef = {
      get: jest.fn((token: unknown) => {
        switch (token) {
          case AssignmentServiceV1:
            return assignmentServiceV1;
          case AssignmentServiceV2:
            return assignmentServiceV2;
          case QuestionService:
            return questionService;
          case AttemptServiceV2:
            return attemptService;
          case TRANSLATION_MAINTENANCE_JOB_RUNNER:
            return translationRunner;
          default:
            throw new Error(`Unexpected token: ${String(token)}`);
        }
      }),
    };

    service = new JobWorkerService(moduleRef as unknown as ModuleRef);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalQueueKeyValue === undefined) {
      delete process.env[jobQueueSecretEnv];
    } else {
      process.env[jobQueueSecretEnv] = originalQueueKeyValue;
    }
  });

  it("creates one worker per queue with the expected concurrency and lifecycle hooks", async () => {
    await service.onModuleInit();

    expect(createRedisConnection).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenNthCalledWith(
      1,
      JOB_QUEUE_NAMES.ASSIGNMENT_V1,
      expect.any(Function),
      { connection: mockConnection, concurrency: 2 },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      2,
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      expect.any(Function),
      { connection: mockConnection, concurrency: 2 },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      3,
      JOB_QUEUE_NAMES.ATTEMPT,
      expect.any(Function),
      { connection: mockConnection, concurrency: 4 },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      4,
      JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
      expect.any(Function),
      { connection: mockConnection, concurrency: 1 },
    );
    expect(workerInstances).toHaveLength(4);
    expect(
      workerInstances.every((worker) => worker.on.mock.calls.length === 2),
    ).toBe(true);
    expect(workerWaitUntilReady).toHaveBeenCalledTimes(4);
  });

  it("closes every worker and the Redis connection on shutdown", async () => {
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(workerClose).toHaveBeenCalledTimes(4);
    expect(mockConnection.quit).toHaveBeenCalledTimes(1);
  });

  it("skips quitting Redis when destroyed before initialization", async () => {
    await service.onModuleDestroy();

    expect(workerClose).not.toHaveBeenCalled();
    expect(mockConnection.quit).not.toHaveBeenCalled();
  });

  it("reuses the same Redis connection across repeated getConnection calls", () => {
    const firstConnection = (service as any).getConnection();
    const secondConnection = (service as any).getConnection();

    expect(firstConnection).toBe(mockConnection);
    expect(secondConnection).toBe(mockConnection);
    expect(createRedisConnection).toHaveBeenCalledTimes(1);
  });

  it("logs completed and failed worker lifecycle events", async () => {
    await service.onModuleInit();

    workerInstances[0].handlers.completed?.({
      id: "job-1",
      name: "assignment-v1.generate-questions",
    });
    const failure = new Error("boom");
    workerInstances[0].handlers.failed?.(
      {
        id: "job-2",
        name: "assignment-v1.publish",
      },
      failure,
    );
    workerInstances[0].handlers.failed?.(undefined, failure);

    expect(logSpy).toHaveBeenCalledWith(
      "Completed assignment-v1.generate-questions#job-1",
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed assignment-v1.publish#job-2: boom",
      failure.stack,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "Failed unknown#unknown: boom",
      failure.stack,
    );
  });

  it("dispatches assignment v1 generation jobs after decrypting the payload", async () => {
    await (service as any).handleAssignmentV1Job({
      name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      data: encryptJobPayload({
        jobId: "job-1",
        assignmentId: 5,
        assignmentType: "QUIZ",
        questionsToGenerate: { multipleChoice: 3 },
        files: [{ filename: "notes.md", content: "study" }],
        learningObjectives: "Learn quickly",
      }),
    });

    expect(assignmentServiceV1.runGenerateQuestionsJob).toHaveBeenCalledWith(
      5,
      "job-1",
      "QUIZ",
      { multipleChoice: 3 },
      [{ filename: "notes.md", content: "study" }],
      "Learn quickly",
    );
  });

  it("dispatches assignment v1 publish jobs", async () => {
    await (service as any).handleAssignmentV1Job({
      name: JOB_NAMES.ASSIGNMENT_V1_PUBLISH,
      data: encryptJobPayload({
        jobId: "publish-1",
        assignmentId: 6,
        updateDto: { title: "Published" },
        userId: "author-1",
      }),
    });

    expect(assignmentServiceV1.runPublishJob).toHaveBeenCalledWith(
      "publish-1",
      6,
      { title: "Published" },
      "author-1",
    );
  });

  it("dispatches assignment v2 question-generation jobs", async () => {
    await (service as any).handleAssignmentV2Job({
      name: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
      data: encryptJobPayload({
        jobId: "job-2",
        assignmentId: 7,
        assignmentType: "HOMEWORK",
        questionsToGenerate: { shortAnswer: 2 },
        fileContents: [{ filename: "outline.txt", content: "outline" }],
        learningObjectives: "Explain concepts",
      }),
    });

    expect(questionService.runQuestionGenerationJob).toHaveBeenCalledWith(
      7,
      "job-2",
      "HOMEWORK",
      { shortAnswer: 2 },
      [{ filename: "outline.txt", content: "outline" }],
      "Explain concepts",
    );
  });

  it("dispatches assignment v2 publish jobs", async () => {
    await (service as any).handleAssignmentV2Job({
      name: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      data: encryptJobPayload({
        jobId: "publish-2",
        assignmentId: 8,
        updateDto: { title: "V2 publish" },
        userId: "author-2",
      }),
    });

    expect(assignmentServiceV2.runPublishJob).toHaveBeenCalledWith(
      "publish-2",
      8,
      { title: "V2 publish" },
      "author-2",
    );
  });

  it("dispatches learner grading jobs and preserves auth/session context", async () => {
    await (service as any).handleAttemptJob({
      name: JOB_NAMES.ATTEMPT_GRADE,
      data: encryptJobPayload({
        gradingJobId: "grading-1",
        attemptId: 99,
        assignmentId: 12,
        updateDto: { submitted: true },
        authCookie: "jwt=123",
        userSession: {
          userId: "learner-1",
          role: "Learner",
          gradingCallbackRequired: false,
        },
      }),
    });

    expect(attemptService.processGradingJob).toHaveBeenCalledWith(
      "grading-1",
      99,
      12,
      { submitted: true },
      "jwt=123",
      {
        userSession: {
          userId: "learner-1",
          role: "Learner",
          gradingCallbackRequired: false,
        },
      },
    );
  });

  it("defaults missing auth cookies for grading jobs and dispatches author previews", async () => {
    await (service as any).handleAttemptJob({
      name: JOB_NAMES.ATTEMPT_GRADE,
      data: encryptJobPayload({
        gradingJobId: "grading-2",
        attemptId: 100,
        assignmentId: 13,
        updateDto: { submitted: false },
        userSession: {
          userId: "learner-2",
          role: "Learner",
          gradingCallbackRequired: true,
        },
      }),
    });
    await (service as any).handleAttemptJob({
      name: JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      data: encryptJobPayload({
        gradingJobId: "preview-1",
        assignmentId: 14,
        updateDto: { preview: true },
        userSession: {
          userId: "author-3",
          role: "Author",
          gradingCallbackRequired: false,
        },
      }),
    });

    expect(attemptService.processGradingJob).toHaveBeenCalledWith(
      "grading-2",
      100,
      13,
      { submitted: false },
      "",
      {
        userSession: {
          userId: "learner-2",
          role: "Learner",
          gradingCallbackRequired: true,
        },
      },
    );
    expect(attemptService.processAuthorPreviewJob).toHaveBeenCalledWith(
      "preview-1",
      14,
      { preview: true },
      "",
      {
        userSession: {
          userId: "author-3",
          role: "Author",
          gradingCallbackRequired: false,
        },
      },
    );
  });

  it("dispatches admin translation jobs", async () => {
    await (service as any).handleAdminTranslationJob({
      name: JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS,
      data: encryptJobPayload({
        jobId: "admin-fix",
        assignmentIds: [1, 2],
        body: { languageCodes: ["es"], dryRun: true },
      }),
    });
    await (service as any).handleAdminTranslationJob({
      name: JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS,
      data: encryptJobPayload({
        jobId: "admin-sweep",
        body: { batchSize: 10, dryRun: false },
      }),
    });

    expect(translationRunner.runFixMissingTranslationsJob).toHaveBeenCalledWith(
      "admin-fix",
      [1, 2],
      { languageCodes: ["es"], dryRun: true },
    );
    expect(
      translationRunner.runSweepMissingTranslationsJob,
    ).toHaveBeenCalledWith("admin-sweep", { batchSize: 10, dryRun: false });
  });

  it.each([
    [
      "handleAssignmentV1Job",
      "unsupported.v1",
      "Unsupported assignment v1 job: unsupported.v1",
    ],
    [
      "handleAssignmentV2Job",
      "unsupported.v2",
      "Unsupported assignment v2 job: unsupported.v2",
    ],
    [
      "handleAttemptJob",
      "unsupported.attempt",
      "Unsupported attempt job: unsupported.attempt",
    ],
    [
      "handleAdminTranslationJob",
      "unsupported.admin",
      "Unsupported admin translation job: unsupported.admin",
    ],
  ])(
    "rejects unsupported jobs in %s",
    async (methodName, jobName, errorMessage) => {
      await expect(
        (service as any)[methodName]({
          name: jobName,
          data: encryptJobPayload({}),
        }),
      ).rejects.toThrow(errorMessage);
    },
  );
});
