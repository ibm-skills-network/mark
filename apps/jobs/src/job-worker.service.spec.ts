import { Logger } from "@nestjs/common";
import { Worker } from "bullmq";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";
import { encryptJobPayload } from "./job-payload.crypto";
import { JobWorkerService } from "./job-worker.service";
import { createRedisConnection } from "./redis.connection";

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

    service = new JobWorkerService();
  });

  afterEach(() => {
    const heartbeatInterval = (service as any).heartbeatInterval as
      | NodeJS.Timeout
      | undefined;
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
        lockDuration: 1_800_000,
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
        lockDuration: 1_800_000,
        maxStalledCount: 0,
      },
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

  // ─── Change 9: configurable GRADING_CONCURRENCY ──────────────────────────

  it("uses GRADING_CONCURRENCY env var to set attempt worker concurrency", async () => {
    process.env.GRADING_CONCURRENCY = "2";

    // Re-create service so the new env var is picked up
    const customService = new JobWorkerService();
    await customService.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const attemptWorkerCall = MockWorker.mock.calls.find(
      (call: unknown[]) => call[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(attemptWorkerCall).toBeDefined();
    expect(attemptWorkerCall[2]).toMatchObject({ concurrency: 2 });

    await customService.onModuleDestroy();
    delete process.env.GRADING_CONCURRENCY;
  });

  it("falls back to concurrency 4 when GRADING_CONCURRENCY is not set", async () => {
    delete process.env.GRADING_CONCURRENCY;
    const defaultService = new JobWorkerService();
    await defaultService.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const attemptWorkerCall = MockWorker.mock.calls.find(
      (call: unknown[]) => call[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(attemptWorkerCall![2]).toMatchObject({ concurrency: 4 });

    await defaultService.onModuleDestroy();
  });

  it("parses GRADING_CONCURRENCY as a base-10 integer", async () => {
    process.env.GRADING_CONCURRENCY = "8";
    const s = new JobWorkerService();
    await s.onModuleInit();

    const MockWorker = Worker as unknown as jest.Mock;
    const call = MockWorker.mock.calls.find(
      (c: unknown[]) => c[0] === JOB_QUEUE_NAMES.ATTEMPT,
    );
    expect(typeof call![2].concurrency).toBe("number");
    expect(call![2].concurrency).toBe(8);

    await s.onModuleDestroy();
    delete process.env.GRADING_CONCURRENCY;
  });

  it("closes every worker and the Redis connection on shutdown", async () => {
    await service.onModuleInit();

    await service.onModuleDestroy();

    expect(workerClose).toHaveBeenCalledTimes(4);
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

  it("forwards assignment v1 generation jobs after decrypting the payload", async () => {
    const payload = {
      jobId: "job-1",
      assignmentId: 5,
      assignmentType: "QUIZ",
      questionsToGenerate: { multipleChoice: 3 },
      files: [{ filename: "notes.md", content: "study" }],
      learningObjectives: "Learn quickly",
    };

    await (service as any).handleAssignmentV1Job({
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

    await (service as any).handleAssignmentV2Job({
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

    await (service as any).handleAssignmentV2Job({
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

    await (service as any).handleAttemptJob({
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

    await (service as any).handleAttemptJob({
      id: "bull-6",
      name: JOB_NAMES.ATTEMPT_GRADE,
      data: encryptJobPayload(gradingPayload),
    });
    await (service as any).handleAttemptJob({
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

    await (service as any).handleAdminTranslationJob({
      id: "bull-8",
      name: JOB_NAMES.ADMIN_FIX_MISSING_TRANSLATIONS,
      data: encryptJobPayload(fixPayload),
    });
    await (service as any).handleAdminTranslationJob({
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

  it("uses the explicit Mark API job executor URL when provided", async () => {
    process.env.MARK_API_JOB_EXECUTOR_URL =
      "http://mark-api:3000/api/internal/jobs/execute";

    await (service as any).handleAssignmentV1Job({
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
      (service as any).handleAssignmentV1Job({
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
