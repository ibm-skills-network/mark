import {
  Body,
  Controller,
  Get,
  INestApplication,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Sse,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { Worker } from "bullmq";
import { decryptJobPayload } from "../src/job-queue/job-payload.crypto";
import { JobQueueModule } from "../src/job-queue/job-queue.module";
import { JobQueueService } from "../src/job-queue/job-queue.service";
import { JobStateService } from "../src/job-queue/job-state.service";
import {
  createRedisTestHarness,
  RedisTestHarness,
} from "../../../test-support/redis-test-harness";

const E2E_QUEUE_NAME = "mark.job-queue.e2e";
const E2E_JOB_NAME = "job-queue.e2e";

interface JobQueueE2EPayload {
  jobId: string;
  payload?: {
    delayMs?: number;
    fail?: boolean;
    marker?: string;
  };
}

async function sleep(durationMs: number) {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function collectSseEvents(
  url: string,
): Promise<Array<{ event: string; data: string }>> {
  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream",
    },
  });

  if (!response.ok) {
    throw new Error(`Unexpected SSE response: ${response.status}`);
  }

  if (!response.body) {
    throw new Error("Expected an SSE response body");
  }

  const reader = response.body.getReader();
  const events: Array<{ event: string; data: string }> = [];
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += Buffer.from(value).toString("utf8");

    while (buffer.includes("\n\n")) {
      const separatorIndex = buffer.indexOf("\n\n");
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const lines = rawEvent.split("\n");
      const event =
        lines
          .find((line) => line.startsWith("event:"))
          ?.slice("event:".length)
          .trim() ?? "message";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      events.push({ event, data });
    }
  }

  return events;
}

@Injectable()
class JobQueueE2EWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  constructor(private readonly jobStateService: JobStateService) {}

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      E2E_QUEUE_NAME,
      async (job) => {
        const payload = decryptJobPayload<JobQueueE2EPayload>(job.data);

        await this.jobStateService.updateJobStatus(payload.jobId, {
          status: "Processing",
          progress: "Worker started",
          percentage: 25,
        });

        if (payload.payload?.delayMs) {
          await sleep(payload.payload.delayMs);
        }

        if (payload.payload?.fail) {
          await this.jobStateService.updateJobStatus(payload.jobId, {
            status: "Failed",
            progress: "Worker rejected the job",
            percentage: 100,
            result: {
              reason: "requested-failure",
              marker: payload.payload.marker ?? null,
            },
          });
          return;
        }

        await this.jobStateService.updateJobStatus(payload.jobId, {
          status: "Completed",
          progress: "Worker finished",
          percentage: 100,
          result: {
            marker: payload.payload?.marker ?? null,
          },
        });
      },
      {
        connection: (this.jobStateService as any).getConnection(),
        concurrency: 1,
      },
    );

    await this.worker.waitUntilReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}

@Controller("job-queue-test")
class JobQueueTestController {
  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly jobStateService: JobStateService,
  ) {}

  @Post("jobs")
  async createJob(
    @Body()
    body: {
      userId?: string;
      activeKey?: string;
      payload?: JobQueueE2EPayload["payload"];
    },
  ) {
    const trackedJob = await this.jobStateService.createJob({
      queueName: E2E_QUEUE_NAME,
      jobName: E2E_JOB_NAME,
      kind: "e2e",
      userId: body.userId ?? "user-1",
      status: "Pending",
      progress: "Queued",
      activeKey: body.activeKey,
    });

    await this.jobQueueService.enqueue(E2E_QUEUE_NAME, E2E_JOB_NAME, {
      jobId: trackedJob.id,
      payload: body.payload,
    });

    return trackedJob;
  }

  @Get("jobs/:jobId")
  async getJob(@Param("jobId") jobId: string) {
    return this.jobStateService.getJob(jobId);
  }

  @Sse("jobs/:jobId/stream")
  streamJob(@Param("jobId") jobId: string) {
    return this.jobStateService.getJobStatusStream(jobId);
  }
}

@Module({
  imports: [JobQueueModule],
  controllers: [JobQueueTestController],
  providers: [JobQueueE2EWorker],
})
class JobQueueE2ETestModule {}

describe("job-queue (e2e)", () => {
  const jobQueueSecretEnv = "JOB_QUEUE_SECRET"; // pragma: allowlist secret
  const originalRedisUrl = process.env.REDIS_URL;
  const originalQueueKeyValue = process.env[jobQueueSecretEnv];

  let redisHarness: RedisTestHarness;
  let app: INestApplication;
  let baseUrl: string;
  let loggerSpy: jest.SpyInstance;

  beforeAll(async () => {
    redisHarness = await createRedisTestHarness();
    process.env.REDIS_URL = redisHarness.redisUrl;
    process.env[jobQueueSecretEnv] = "e2e-secret";
    loggerSpy = jest
      .spyOn(Logger.prototype, "log")
      .mockImplementation(() => undefined);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [JobQueueE2ETestModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const address = app.getHttpServer().address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to determine e2e server address");
    }

    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  beforeEach(async () => {
    await redisHarness.flush();
  });

  afterAll(async () => {
    await app.close();
    await redisHarness.stop();
    loggerSpy.mockRestore();

    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }

    if (originalQueueKeyValue === undefined) {
      delete process.env[jobQueueSecretEnv];
    } else {
      process.env[jobQueueSecretEnv] = originalQueueKeyValue;
    }
  });

  it("creates a queued job over HTTP and streams terminal completion over SSE", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/job-queue-test/jobs")
      .send({
        userId: "author-1",
        activeKey: "assignment:7:user:author-1",
        payload: {
          delayMs: 150,
          marker: "completed-marker",
        },
      })
      .expect(201);

    const jobId = createResponse.body.id as string;
    const events = await collectSseEvents(
      `${baseUrl}/job-queue-test/jobs/${jobId}/stream`,
    );

    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(["update", "finalize"]),
    );

    const finalEvent = events.find((event) => event.event === "finalize");
    expect(JSON.parse(finalEvent?.data ?? "{}")).toMatchObject({
      jobId,
      status: "Completed",
      done: true,
      percentage: 100,
      result: JSON.stringify({ marker: "completed-marker" }),
    });

    const statusResponse = await request(app.getHttpServer())
      .get(`/job-queue-test/jobs/${jobId}`)
      .expect(200);

    expect(statusResponse.body).toMatchObject({
      id: jobId,
      status: "Completed",
      progress: "Worker finished",
      result: {
        marker: "completed-marker",
      },
    });
  });

  it("surfaces failed worker execution as an SSE error event", async () => {
    const createResponse = await request(app.getHttpServer())
      .post("/job-queue-test/jobs")
      .send({
        userId: "author-2",
        payload: {
          delayMs: 50,
          fail: true,
          marker: "failure-marker",
        },
      })
      .expect(201);

    const jobId = createResponse.body.id as string;
    const events = await collectSseEvents(
      `${baseUrl}/job-queue-test/jobs/${jobId}/stream`,
    );
    const errorEvent = events.find((event) => event.event === "error");

    expect(errorEvent).toBeDefined();
    expect(JSON.parse(errorEvent?.data ?? "{}")).toMatchObject({
      jobId,
      status: "Failed",
      done: true,
      percentage: 100,
      result: JSON.stringify({
        reason: "requested-failure",
        marker: "failure-marker",
      }),
    });

    const statusResponse = await request(app.getHttpServer())
      .get(`/job-queue-test/jobs/${jobId}`)
      .expect(200);

    expect(statusResponse.body).toMatchObject({
      id: jobId,
      status: "Failed",
      progress: "Worker rejected the job",
      result: {
        reason: "requested-failure",
        marker: "failure-marker",
      },
    });
  });
});
