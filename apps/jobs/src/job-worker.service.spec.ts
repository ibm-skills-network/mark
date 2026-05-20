import { Logger } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { JobExecutorService } from "../../api/src/job-queue/job-executor.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";
import { encryptJobPayload } from "./job-payload.crypto";
import { JobWorkerService } from "./job-worker.service";
import { createRedisConnection } from "./redis.connection";

// Typed test-only accessor that exposes the four per-queue handlers and the
// shared internals these tests exercise. Defined locally so production code
// stays unchanged; exists strictly so the suite can call private methods
// without sprinkling `as any` (which silently type-checks even if the method
// is renamed). If a private member referenced here is renamed in the
// service, the cast site below fails to compile — surfacing the rename
// through CI rather than letting tests silently pass against an undefined
// property lookup.
type JobWorkerServiceTestAccessor = JobWorkerService & {
  handleAssignmentV1Job: (job: Job) => Promise<void>;
  handleAssignmentV2Job: (job: Job) => Promise<void>;
  handleAttemptJob: (job: Job) => Promise<void>;
  handleAdminTranslationJob: (job: Job) => Promise<void>;
  handleTranslationJob: (job: Job) => Promise<void>;
  getConnection: () => IORedis;
  heartbeatInterval?: NodeJS.Timeout;
};

const asTestAccessor = (s: JobWorkerService): JobWorkerServiceTestAccessor =>
  s as JobWorkerServiceTestAccessor;

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

jest.mock("./redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

// Mock the cross-package JobExecutorService module at the boundary. apps/api
// uses absolute "src/..." imports throughout; those resolve at type-check time
// via apps/jobs/tsconfig.json paths but NOT at jest runtime. Stubbing the
// module here keeps the test runner from following the transitive graph into
// api source while the structural mock below stands in for the real instance.
jest.mock(
  "../../api/src/job-queue/job-executor.service",
  () => ({
    JobExecutorService: class {},
  }),
  { virtual: false },
);

const mockJobExecutorService = {
  executeJob: jest.fn(),
};

// Mock Winston parent logger. `.child()` returns an object exposing the same
// info/warn/error/debug methods so the service's child-context idiom resolves
// to a working logger surface in tests. Jest fns let individual tests assert
// the structured-payload contract (publish.translation.job.start / .complete
// / .failed) without coupling to a real winston transport.
const mockStructuredLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
const mockParentWinstonLogger = {
  child: jest.fn(() => mockStructuredLogger),
} as unknown as import("winston").Logger;

describe("JobWorkerService", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];
  const originalMarkApiEndpoint = process.env.MARK_API_ENDPOINT;
  const originalMarkApiJobExecutorUrl = process.env.MARK_API_JOB_EXECUTOR_URL;
  const originalMarkApiUrl = process.env.MARK_API_URL;
  const originalApiPort = process.env.API_PORT;
  const originalFetch = global.fetch;
  const mockConnection = {
    del: jest.fn(),
    quit: jest.fn(),
    set: jest.fn(),
  };
  const fetchMock = jest.fn();

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
    process.env.API_PORT = "4222";
    delete process.env.MARK_API_ENDPOINT;
    delete process.env.MARK_API_JOB_EXECUTOR_URL;
    delete process.env.MARK_API_URL;

    workerClose.mockResolvedValue(undefined);
    workerWaitUntilReady.mockResolvedValue(undefined);
    mockConnection.del.mockResolvedValue(undefined);
    mockConnection.quit.mockResolvedValue(undefined);
    mockConnection.set.mockResolvedValue("OK");
    (createRedisConnection as jest.Mock).mockReturnValue(mockConnection);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      text: jest.fn().mockResolvedValue(""),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockJobExecutorService.executeJob = jest.fn();
    mockStructuredLogger.info.mockClear();
    mockStructuredLogger.warn.mockClear();
    mockStructuredLogger.error.mockClear();
    mockStructuredLogger.debug.mockClear();

    service = new JobWorkerService(
      mockJobExecutorService as unknown as JobExecutorService,
      mockParentWinstonLogger,
    );
  });

  afterEach(() => {
    const heartbeatInterval = asTestAccessor(service).heartbeatInterval;
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    logSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalQueueKeyValue === undefined) {
      delete process.env[jobQueueSecretEnv];
    } else {
      process.env[jobQueueSecretEnv] = originalQueueKeyValue;
    }
    if (originalMarkApiEndpoint === undefined) {
      delete process.env.MARK_API_ENDPOINT;
    } else {
      process.env.MARK_API_ENDPOINT = originalMarkApiEndpoint;
    }
    if (originalMarkApiJobExecutorUrl === undefined) {
      delete process.env.MARK_API_JOB_EXECUTOR_URL;
    } else {
      process.env.MARK_API_JOB_EXECUTOR_URL = originalMarkApiJobExecutorUrl;
    }
    if (originalMarkApiUrl === undefined) {
      delete process.env.MARK_API_URL;
    } else {
      process.env.MARK_API_URL = originalMarkApiUrl;
    }
    if (originalApiPort === undefined) {
      delete process.env.API_PORT;
    } else {
      process.env.API_PORT = originalApiPort;
    }
    global.fetch = originalFetch;
  });

  function expectLastForwardedJob(expected: {
    bullJobId: string;
    jobName: string;
    payload: unknown;
    queueName: string;
    attemptsMade?: number;
    maxAttempts?: number;
  }): void {
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://localhost:4222/api/internal/jobs/execute",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-job-queue-secret": "worker-test-secret", // pragma: allowlist secret
        },
      }),
    );
    const [, requestInit] = fetchMock.mock.calls[
      fetchMock.mock.calls.length - 1
    ] as [string, RequestInit];
    expect(JSON.parse(requestInit.body as string)).toEqual(expected);
  }

  it("creates one worker per queue with the expected concurrency and lifecycle hooks", async () => {
    await service.onModuleInit();

    expect(createRedisConnection).toHaveBeenCalledTimes(1);
    expect(mockConnection.set).toHaveBeenCalledWith(
      expect.stringMatching(/^mark\.jobs\.worker\.heartbeat:/),
      expect.any(String),
      "EX",
      30,
    );
    expect(Worker).toHaveBeenNthCalledWith(
      1,
      JOB_QUEUE_NAMES.ASSIGNMENT_V1,
      expect.any(Function),
      {
        connection: mockConnection,
        concurrency: 2,
        lockDuration: 1_890_000,
        maxStalledCount: 0,
      },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      2,
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      expect.any(Function),
      {
        connection: mockConnection,
        concurrency: 2,
        lockDuration: 1_890_000,
        maxStalledCount: 0,
      },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      3,
      JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
      expect.any(Function),
      {
        connection: mockConnection,
        concurrency: 8,
        lockDuration: 120_000,
        maxStalledCount: 0,
      },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      4,
      JOB_QUEUE_NAMES.ATTEMPT,
      expect.any(Function),
      { connection: mockConnection, concurrency: 4 },
    );
    expect(Worker).toHaveBeenNthCalledWith(
      5,
      JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
      expect.any(Function),
      { connection: mockConnection, concurrency: 1 },
    );
    expect(workerInstances).toHaveLength(5);
    expect(
      workerInstances.every((worker) => worker.on.mock.calls.length === 2),
    ).toBe(true);
    expect(workerWaitUntilReady).toHaveBeenCalledTimes(5);
  });

  // ─── Change 9: configurable GRADING_WORKER_CONCURRENCY ──────────────────────────

  it("uses GRADING_WORKER_CONCURRENCY env var to set attempt worker concurrency", async () => {
    process.env.GRADING_WORKER_CONCURRENCY = "2";

    // Re-create service so the new env var is picked up
    const customService = new JobWorkerService(
      mockJobExecutorService as unknown as JobExecutorService,
      mockParentWinstonLogger,
    );
    await customService.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const attemptWorkerCall = MockWorker.mock.calls.find(
      (call: unknown[]) => call[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(attemptWorkerCall).toBeDefined();
    expect(attemptWorkerCall[2]).toMatchObject({ concurrency: 2 });

    await customService.onModuleDestroy();
    delete process.env.GRADING_WORKER_CONCURRENCY;
  });

  it("falls back to concurrency 4 when GRADING_WORKER_CONCURRENCY is not set", async () => {
    delete process.env.GRADING_WORKER_CONCURRENCY;
    const defaultService = new JobWorkerService(
      mockJobExecutorService as unknown as JobExecutorService,
      mockParentWinstonLogger,
    );
    await defaultService.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const attemptWorkerCall = MockWorker.mock.calls.find(
      (call: unknown[]) => call[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(attemptWorkerCall![2]).toMatchObject({ concurrency: 4 });

    await defaultService.onModuleDestroy();
  });

  it("parses GRADING_WORKER_CONCURRENCY as a base-10 integer", async () => {
    process.env.GRADING_WORKER_CONCURRENCY = "8";
    const s = new JobWorkerService(
      mockJobExecutorService as unknown as JobExecutorService,
      mockParentWinstonLogger,
    );
    await s.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const call = MockWorker.mock.calls.find(
      (c: unknown[]) => c[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(typeof call![2].concurrency).toBe("number");
    expect(call![2].concurrency).toBe(8);

    await s.onModuleDestroy();
    delete process.env.GRADING_WORKER_CONCURRENCY;
  });

  it("closes every worker and the Redis connection on shutdown", async () => {
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(workerClose).toHaveBeenCalledTimes(5);
    expect(mockConnection.del).toHaveBeenCalledWith(
      expect.stringMatching(/^mark\.jobs\.worker\.heartbeat:/),
    );
    expect(mockConnection.quit).toHaveBeenCalledTimes(1);
  });

  it("skips quitting Redis when destroyed before initialization", async () => {
    await service.onModuleDestroy();

    expect(workerClose).not.toHaveBeenCalled();
    expect(mockConnection.quit).not.toHaveBeenCalled();
  });

  it("reuses the same Redis connection across repeated getConnection calls", () => {
    const firstConnection = asTestAccessor(service).getConnection();
    const secondConnection = asTestAccessor(service).getConnection();

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

  it("forwards assignment v1 generation jobs after decrypting the payload", async () => {
    const payload = {
      jobId: "job-1",
      assignmentId: 5,
      assignmentType: "QUIZ",
      questionsToGenerate: { multipleChoice: 3 },
      files: [{ filename: "notes.md", content: "study" }],
      learningObjectives: "Learn quickly",
    };

    await asTestAccessor(service).handleAssignmentV1Job({
      id: "bull-1",
      name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      data: encryptJobPayload(payload),
    });

    expectLastForwardedJob({
      bullJobId: "bull-1",
      jobName: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      payload,
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V1,
    });
  });

  it("forwards assignment v2 question-generation jobs", async () => {
    const payload = {
      jobId: "job-2",
      assignmentId: 7,
      assignmentType: "HOMEWORK",
      questionsToGenerate: { shortAnswer: 2 },
      fileContents: [{ filename: "outline.txt", content: "outline" }],
      learningObjectives: "Explain concepts",
    };

    await asTestAccessor(service).handleAssignmentV2Job({
      id: "bull-3",
      name: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
      data: encryptJobPayload(payload),
    });

    expectLastForwardedJob({
      bullJobId: "bull-3",
      jobName: JOB_NAMES.ASSIGNMENT_V2_GENERATE_QUESTIONS,
      payload,
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
    });
  });

  it("forwards assignment v2 publish jobs", async () => {
    const payload = {
      jobId: "publish-2",
      assignmentId: 8,
      updateDto: { title: "V2 publish" },
      userId: "author-2",
    };

    await asTestAccessor(service).handleAssignmentV2Job({
      id: "bull-4",
      name: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      data: encryptJobPayload(payload),
    });

    expectLastForwardedJob({
      bullJobId: "bull-4",
      jobName: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      payload,
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
    });
  });

  it("forwards learner grading jobs and preserves auth/session context", async () => {
    const payload = {
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
    };

    await asTestAccessor(service).handleAttemptJob({
      id: "bull-5",
      name: JOB_NAMES.ATTEMPT_GRADE,
      data: encryptJobPayload(payload),
    });

    expectLastForwardedJob({
      bullJobId: "bull-5",
      jobName: JOB_NAMES.ATTEMPT_GRADE,
      payload,
      queueName: JOB_QUEUE_NAMES.ATTEMPT,
    });
  });

  it("forwards grading jobs without auth cookies and author previews", async () => {
    const gradingPayload = {
      gradingJobId: "grading-2",
      attemptId: 100,
      assignmentId: 13,
      updateDto: { submitted: false },
      userSession: {
        userId: "learner-2",
        role: "Learner",
        gradingCallbackRequired: true,
      },
    };
    const previewPayload = {
      gradingJobId: "preview-1",
      assignmentId: 14,
      updateDto: { preview: true },
      userSession: {
        userId: "author-3",
        role: "Author",
        gradingCallbackRequired: false,
      },
    };

    await asTestAccessor(service).handleAttemptJob({
      id: "bull-6",
      name: JOB_NAMES.ATTEMPT_GRADE,
      data: encryptJobPayload(gradingPayload),
    });
    await asTestAccessor(service).handleAttemptJob({
      id: "bull-7",
      name: JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      data: encryptJobPayload(previewPayload),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      bullJobId: "bull-6",
      jobName: JOB_NAMES.ATTEMPT_GRADE,
      payload: gradingPayload,
      queueName: JOB_QUEUE_NAMES.ATTEMPT,
    });
    expectLastForwardedJob({
      bullJobId: "bull-7",
      jobName: JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      payload: previewPayload,
      queueName: JOB_QUEUE_NAMES.ATTEMPT,
    });
  });

  it("forwards admin translation jobs", async () => {
    const fixPayload = {
      jobId: "admin-fix",
      assignmentIds: [1, 2],
      body: { languageCodes: ["es"], dryRun: true },
    };
    const sweepPayload = {
      jobId: "admin-sweep",
      body: { batchSize: 10, dryRun: false },
    };

    await asTestAccessor(service).handleAdminTranslationJob({
      id: "bull-8",
      name: JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS,
      data: encryptJobPayload(fixPayload),
    });
    await asTestAccessor(service).handleAdminTranslationJob({
      id: "bull-9",
      name: JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS,
      data: encryptJobPayload(sweepPayload),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string),
    ).toEqual({
      bullJobId: "bull-8",
      jobName: JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS,
      payload: fixPayload,
      queueName: JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
    });
    expectLastForwardedJob({
      bullJobId: "bull-9",
      jobName: JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS,
      payload: sweepPayload,
      queueName: JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
    });
  });

  it("passes an AbortSignal to fetch so the forward survives past Node's default 5-minute bodyTimeout", async () => {
    // Long-running parent publish jobs run well past the undici default
    // bodyTimeout of 300_000ms. Without an explicit signal the forward
    // would abort at the 5-minute mark while mark-api is still processing,
    // leaving the parent zombied. The forward must pass a signal that
    // outlives the longest BullMQ lockDuration.
    await asTestAccessor(service).handleAssignmentV1Job({
      id: "bull-timeout-1",
      name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      data: encryptJobPayload({
        jobId: "timeout-test",
        assignmentId: 1,
        assignmentType: "HOMEWORK",
        questionsToGenerate: { shortAnswer: 1 },
      }),
    });

    const [, requestInit] = fetchMock.mock.calls[
      fetchMock.mock.calls.length - 1
    ] as [string, RequestInit & { dispatcher?: unknown }];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
    expect(requestInit.signal?.aborted).toBe(false);
    // AbortSignal alone is not sufficient — undici's bodyTimeout /
    // headersTimeout still default to 5 min and fire while a long-running
    // parent publish is mid-flight. The forward must also pass a custom
    // dispatcher so undici uses the extended per-byte silence threshold.
    expect(requestInit.dispatcher).toBeDefined();
  });

  it("uses the explicit Mark API job executor URL when provided", async () => {
    process.env.MARK_API_JOB_EXECUTOR_URL =
      "http://mark-api:3000/api/internal/jobs/execute";

    await asTestAccessor(service).handleAssignmentV1Job({
      id: "bull-explicit",
      name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
      data: encryptJobPayload({
        jobId: "gen-explicit",
        assignmentId: 6,
        assignmentType: "HOMEWORK",
        questionsToGenerate: { shortAnswer: 1 },
      }),
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://mark-api:3000/api/internal/jobs/execute",
      expect.any(Object),
    );
  });

  it("throws when Mark API rejects job execution", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: jest.fn().mockResolvedValue("job failed"),
    });

    await expect(
      asTestAccessor(service).handleAssignmentV1Job({
        id: "bull-failed",
        name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
        data: encryptJobPayload({
          jobId: "gen-failed",
          assignmentId: 6,
          assignmentType: "HOMEWORK",
          questionsToGenerate: { shortAnswer: 1 },
        }),
      }),
    ).rejects.toThrow(
      "Mark API job execution failed for assignment-v1.generate-questions#bull-failed: 500 Internal Server Error - job failed",
    );
  });

  type HandlerName =
    | "handleAssignmentV1Job"
    | "handleAssignmentV2Job"
    | "handleAttemptJob"
    | "handleAdminTranslationJob";
  it.each<[HandlerName, string, string]>([
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
      const handler = asTestAccessor(service)[methodName];
      await expect(
        handler.call(service, {
          name: jobName,
          data: encryptJobPayload({}),
        } as unknown as Job),
      ).rejects.toThrow(errorMessage);
    },
  );

  describe("handleTranslationJob", () => {
    const originalFlag = process.env.JOBS_EXECUTE_LOCALLY;

    afterAll(() => {
      if (originalFlag === undefined) {
        delete process.env.JOBS_EXECUTE_LOCALLY;
      } else {
        process.env.JOBS_EXECUTE_LOCALLY = originalFlag;
      }
    });

    beforeEach(() => {
      delete process.env.JOBS_EXECUTE_LOCALLY;
    });

    it("forwards translation jobs and emits start + complete structured logs", async () => {
      const payload = {
        assignmentId: 42,
        questionId: 7,
        parentJobId: "publish-100",
      };

      await asTestAccessor(service).handleTranslationJob({
        id: "bull-tx-1",
        name: JOB_NAMES.TRANSLATE_QUESTION,
        data: encryptJobPayload(payload),
        attemptsMade: 1,
        opts: { attempts: 3 },
      } as unknown as Job);

      expectLastForwardedJob({
        bullJobId: "bull-tx-1",
        jobName: JOB_NAMES.TRANSLATE_QUESTION,
        payload,
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        attemptsMade: 1,
        maxAttempts: 3,
      });

      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        "publish.translation.job.start",
        expect.objectContaining({
          assignmentId: 42,
          kind: "question",
          id: 7,
          jobId: "bull-tx-1",
          jobName: JOB_NAMES.TRANSLATE_QUESTION,
          languageCount: 23,
        }),
      );
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        "publish.translation.job.complete",
        expect.objectContaining({
          assignmentId: 42,
          kind: "question",
          id: 7,
          jobId: "bull-tx-1",
          durationMs: expect.any(Number),
        }),
      );
      expect(mockStructuredLogger.error).not.toHaveBeenCalled();
    });

    it("routes locally when JOBS_EXECUTE_LOCALLY=true for variant jobs", async () => {
      process.env.JOBS_EXECUTE_LOCALLY = "true";
      const payload = { assignmentId: 11, variantId: 3 };

      await asTestAccessor(service).handleTranslationJob({
        id: "bull-tx-2",
        name: JOB_NAMES.TRANSLATE_VARIANT,
        data: encryptJobPayload(payload),
        attemptsMade: 2,
        opts: { attempts: 3 },
      } as unknown as Job);

      expect(mockJobExecutorService.executeJob).toHaveBeenCalledWith({
        queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        jobName: JOB_NAMES.TRANSLATE_VARIANT,
        payload,
        bullJobId: "bull-tx-2",
        attemptsMade: 2,
        maxAttempts: 3,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        "publish.translation.job.start",
        expect.objectContaining({ kind: "variant", id: 3 }),
      );
    });

    it("treats translate-meta as the meta kind keyed by assignmentId", async () => {
      const payload = { assignmentId: 99 };

      await asTestAccessor(service).handleTranslationJob({
        id: "bull-tx-3",
        name: JOB_NAMES.TRANSLATE_META,
        data: encryptJobPayload(payload),
      } as unknown as Job);

      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        "publish.translation.job.start",
        expect.objectContaining({
          assignmentId: 99,
          kind: "meta",
          id: 99,
          jobName: JOB_NAMES.TRANSLATE_META,
        }),
      );
    });

    it("emits a failed log line and rethrows on downstream forward failure", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: jest.fn().mockResolvedValue("upstream down"),
      });

      await expect(
        asTestAccessor(service).handleTranslationJob({
          id: "bull-tx-fail",
          name: JOB_NAMES.TRANSLATE_QUESTION,
          data: encryptJobPayload({ assignmentId: 5, questionId: 2 }),
        } as unknown as Job),
      ).rejects.toThrow(/Mark API job execution failed/);

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        "publish.translation.job.failed",
        expect.objectContaining({
          assignmentId: 5,
          kind: "question",
          id: 2,
          jobId: "bull-tx-fail",
          error: expect.stringContaining("Mark API job execution failed"),
        }),
      );
      // Complete log line must NOT fire when the worker throws.
      const completeCalls = mockStructuredLogger.info.mock.calls.filter(
        (call) => call[0] === "publish.translation.job.complete",
      );
      expect(completeCalls).toHaveLength(0);
    });

    it("rejects unsupported translation job names with a failed log line", async () => {
      await expect(
        asTestAccessor(service).handleTranslationJob({
          id: "bull-tx-bad",
          name: "unsupported.translation",
          data: encryptJobPayload({ assignmentId: 1 }),
        } as unknown as Job),
      ).rejects.toThrow("Unsupported translation job: unsupported.translation");

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        "publish.translation.job.failed",
        expect.objectContaining({
          error: "Unsupported translation job: unsupported.translation",
        }),
      );
    });

    it("never includes translatedText/translatedChoices/error.stack in structured payloads", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: jest.fn().mockResolvedValue("oops"),
      });

      await asTestAccessor(service)
        .handleTranslationJob({
          id: "bull-tx-safety",
          name: JOB_NAMES.TRANSLATE_QUESTION,
          data: encryptJobPayload({ assignmentId: 1, questionId: 2 }),
        } as unknown as Job)
        .catch(() => undefined);

      const allStructuredCalls = [
        ...mockStructuredLogger.info.mock.calls,
        ...mockStructuredLogger.warn.mock.calls,
        ...mockStructuredLogger.error.mock.calls,
      ];
      for (const call of allStructuredCalls) {
        const payload = call[1] as Record<string, unknown> | undefined;
        if (!payload) continue;
        const keys = Object.keys(payload);
        expect(keys).not.toContain("translatedText");
        expect(keys).not.toContain("translatedChoices");
        expect(keys).not.toContain("stack");
        // The "error" field may exist (it carries error.message as a string)
        // but its VALUE must be a string, never an Error object whose
        // toString would surface stack frames if serialized by transports.
        if ("error" in payload) {
          expect(typeof payload.error).toBe("string");
        }
      }
    });
  });

  describe("JOBS_EXECUTE_LOCALLY routing (per-handler)", () => {
    const originalFlag = process.env.JOBS_EXECUTE_LOCALLY;

    afterAll(() => {
      if (originalFlag === undefined) {
        delete process.env.JOBS_EXECUTE_LOCALLY;
      } else {
        process.env.JOBS_EXECUTE_LOCALLY = originalFlag;
      }
    });

    describe.each([
      { flag: undefined as string | undefined, expected: "forward" as const },
      { flag: "" as string | undefined, expected: "forward" as const },
      { flag: "false" as string | undefined, expected: "forward" as const },
      { flag: "true" as string | undefined, expected: "local" as const },
      { flag: "True" as string | undefined, expected: "forward" as const },
    ])("flag=$flag -> $expected", ({ flag, expected }) => {
      beforeEach(() => {
        if (flag === undefined) {
          delete process.env.JOBS_EXECUTE_LOCALLY;
        } else {
          process.env.JOBS_EXECUTE_LOCALLY = flag;
        }
      });

      it("routes assignment-v1 generation correctly", async () => {
        const payload = {
          jobId: "gen-1",
          assignmentId: 1,
          assignmentType: "QUIZ",
          questionsToGenerate: { multipleChoice: 1 },
        };
        await asTestAccessor(service).handleAssignmentV1Job({
          id: "bull-route-1",
          name: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
          data: encryptJobPayload(payload),
        });
        if (expected === "local") {
          expect(mockJobExecutorService.executeJob).toHaveBeenCalledWith({
            queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V1,
            jobName: JOB_NAMES.ASSIGNMENT_V1_GENERATE_QUESTIONS,
            payload,
            bullJobId: "bull-route-1",
          });
          expect(fetchMock).not.toHaveBeenCalled();
        } else {
          expect(fetchMock).toHaveBeenCalled();
          expect(mockJobExecutorService.executeJob).not.toHaveBeenCalled();
        }
      });

      it("routes assignment-v2 publish correctly", async () => {
        const payload = {
          jobId: "publish-route",
          assignmentId: 1,
          updateDto: { title: "x" },
          userId: "u",
        };
        await asTestAccessor(service).handleAssignmentV2Job({
          id: "bull-route-2",
          name: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
          data: encryptJobPayload(payload),
        });
        if (expected === "local") {
          expect(mockJobExecutorService.executeJob).toHaveBeenCalledWith({
            queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2,
            jobName: JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
            payload,
            bullJobId: "bull-route-2",
          });
          expect(fetchMock).not.toHaveBeenCalled();
        } else {
          expect(fetchMock).toHaveBeenCalled();
          expect(mockJobExecutorService.executeJob).not.toHaveBeenCalled();
        }
      });

      it("routes attempt grade correctly", async () => {
        const payload = {
          gradingJobId: "grade-route",
          attemptId: 1,
          assignmentId: 1,
          updateDto: { submitted: true },
          userSession: {
            userId: "learner-route",
            role: "Learner",
            gradingCallbackRequired: false,
          },
        };
        await asTestAccessor(service).handleAttemptJob({
          id: "bull-route-3",
          name: JOB_NAMES.ATTEMPT_GRADE,
          data: encryptJobPayload(payload),
        });
        if (expected === "local") {
          expect(mockJobExecutorService.executeJob).toHaveBeenCalledWith({
            queueName: JOB_QUEUE_NAMES.ATTEMPT,
            jobName: JOB_NAMES.ATTEMPT_GRADE,
            payload,
            bullJobId: "bull-route-3",
          });
          expect(fetchMock).not.toHaveBeenCalled();
        } else {
          expect(fetchMock).toHaveBeenCalled();
          expect(mockJobExecutorService.executeJob).not.toHaveBeenCalled();
        }
      });

      it("routes admin-translation sweep correctly", async () => {
        const payload = {
          jobId: "sweep-route",
          body: { batchSize: 10, dryRun: false },
        };
        await asTestAccessor(service).handleAdminTranslationJob({
          id: "bull-route-4",
          name: JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS,
          data: encryptJobPayload(payload),
        });
        if (expected === "local") {
          expect(mockJobExecutorService.executeJob).toHaveBeenCalledWith({
            queueName: JOB_QUEUE_NAMES.ADMIN_TRANSLATION,
            jobName: JOB_NAMES.ADMIN_SWEEP_MISSING_TRANSLATIONS,
            payload,
            bullJobId: "bull-route-4",
          });
          expect(fetchMock).not.toHaveBeenCalled();
        } else {
          expect(fetchMock).toHaveBeenCalled();
          expect(mockJobExecutorService.executeJob).not.toHaveBeenCalled();
        }
      });
    });
  });
});
