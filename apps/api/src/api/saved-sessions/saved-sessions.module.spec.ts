import {
  Global,
  INestApplication,
  Logger,
  Module,
  ValidationPipe,
  VersioningType,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { CronExpression, SchedulerRegistry } from "@nestjs/schedule";
import { Test } from "@nestjs/testing";
import { json } from "express";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import request from "supertest";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { DatabaseCircuitBreakerService } from "../../database/circuit-breaker/database-circuit-breaker.service";
import { PrismaService } from "../../database/prisma.service";
import { getJobQueueSecret } from "../../job-queue/job-payload.crypto";
import { ApiModule } from "../api.module";
import { SavedSessionsModule } from "./saved-sessions.module";

const key = {
  storeId: "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11",
  role: "learner",
  assignmentId: 4892,
};
const token = "header.saved-session-marker.signature";
const savedSession = {
  findUnique: jest.fn(),
  upsert: jest.fn(),
  deleteMany: jest.fn(),
};
const log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };

@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: { savedSession } },
    { provide: WINSTON_MODULE_PROVIDER, useValue: { child: () => log } },
    {
      provide: DatabaseCircuitBreakerService,
      useValue: { getStats: () => ({ state: "CLOSED" }) },
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [
    PrismaService,
    WINSTON_MODULE_PROVIDER,
    DatabaseCircuitBreakerService,
  ],
})
class InfrastructureModule {}

describe("SavedSessionsModule in the mark-api app", () => {
  let app: INestApplication;
  const environment = { ...process.env };
  const secret = getJobQueueSecret();

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [InfrastructureModule, SavedSessionsModule],
    }).compile();
    // Mirrors the routing setup in main.ts.
    app = moduleReference.createNestApplication({ logger: false });
    app.use(json({ limit: "1000mb" }));
    app.setGlobalPrefix("api", { exclude: ["health"] });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env = environment;
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("is mounted by ApiModule", () => {
    expect(Reflect.getMetadata("imports", ApiModule)).toContain(
      SavedSessionsModule,
    );
  });

  it("serves lookup and save at the unversioned paths the gateway calls", async () => {
    savedSession.findUnique.mockResolvedValue({ token });
    savedSession.upsert.mockResolvedValue({});
    const lookup = await request(app.getHttpServer())
      .post("/api/internal/saved-sessions/lookup")
      .set("x-job-queue-secret", secret)
      .send(key);
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual({ token });
    expect(savedSession.findUnique).toHaveBeenCalledWith({
      where: { storeId_role_assignmentId: key },
      select: { token: true },
    });

    const save = await request(app.getHttpServer())
      .put("/api/internal/saved-sessions")
      .set("x-job-queue-secret", secret)
      .send({ ...key, token });
    expect(save.status).toBe(204);
    expect(savedSession.upsert).toHaveBeenCalledWith({
      where: { storeId_role_assignmentId: key },
      create: { ...key, token },
      update: { token },
    });
  });

  it("logs failed saves by body keys only, never the token or store id", async () => {
    const put = (body: object, header?: string) => {
      const call = request(app.getHttpServer())
        .put("/api/internal/saved-sessions")
        .send(body);
      return header === undefined
        ? call
        : call.set("x-job-queue-secret", header);
    };
    savedSession.upsert.mockRejectedValue(new Error("db down"));

    expect((await put({ ...key, token })).status).toBe(403);
    expect((await put({ ...key, role: "admin", token }, secret)).status).toBe(
      400,
    );
    expect((await put({ ...key, token }, secret)).status).toBe(500);

    const logged = JSON.stringify([
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(logged).toContain(
      '"body_keys":["storeId","role","assignmentId","token"]',
    );
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(key.storeId);
  });

  it.each([undefined, "wrong-secret"])(
    "refuses lookups without the internal secret (%p)",
    async (header) => {
      savedSession.findUnique.mockResolvedValue({ token });
      const call = request(app.getHttpServer())
        .post("/api/internal/saved-sessions/lookup")
        .send(key);

      const response = await (header === undefined
        ? call
        : call.set("x-job-queue-secret", header));

      expect(response.status).toBe(403);
      expect(response.text).not.toContain(token);
      expect(savedSession.findUnique).not.toHaveBeenCalled();
    },
  );

  it("schedules a daily prune of old saved sessions", async () => {
    const jobs = [...app.get(SchedulerRegistry).getCronJobs().values()];
    expect(jobs.map((job) => String(job.cronTime.source))).toEqual([
      CronExpression.EVERY_DAY_AT_3AM,
    ]);

    process.env.ENABLE_JOB_SCHEDULERS = "true";
    delete process.env.SAVED_SESSION_RETENTION_DAYS;
    savedSession.deleteMany.mockResolvedValue({ count: 0 });
    await jobs[0].fireOnTick();
    expect(savedSession.deleteMany).toHaveBeenCalledTimes(1);
    const [[{ where }]] = savedSession.deleteMany.mock.calls as [
      [{ where: { updatedAt: { lt: Date } } }],
    ];
    expect(
      (Date.now() - where.updatedAt.lt.getTime()) / 86_400_000,
    ).toBeCloseTo(3, 3);
  });
});
