import { HttpService } from "@nestjs/axios";
import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncStatus } from "@prisma/client";
import { AxiosResponse } from "axios";
import { of } from "rxjs";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { PrismaService } from "../../../database/prisma.service";
import {
  LtiGradeSyncService,
  ORPHANED_SYNC_STALE_MS,
} from "./lti-grade-sync.service";

function cookieFor(claims: Record<string, unknown>): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}.signature`;
}

const OUTCOME_URL = "https://lms.example.com/mod/lti/service.php";

const launchCookie = (overrides: Record<string, unknown> = {}) =>
  cookieFor({
    userID: "learner@example.com",
    assignmentID: 3344,
    groupID: "course-a",
    lis_outcome_service_url: OUTCOME_URL,
    lis_result_sourcedid: `sourcedid-${Math.random()}`,
    ...overrides,
  });

const okResponse = { status: 200, data: {} } as AxiosResponse;

describe("LtiGradeSyncService orphan recovery", () => {
  let service: LtiGradeSyncService;

  const prisma = {
    ltiGradeSync: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ltiSyncErrorLog: { create: jest.fn() },
    userNotification: { create: jest.fn() },
  };
  const http = { put: jest.fn() };
  const email = {
    sendGenericEmail: jest.fn().mockResolvedValue(true),
    learnerResultsUrl: jest.fn(() => "https://mark.example.com/results"),
  };

  const orphan = (overrides: Record<string, unknown> = {}) => ({
    id: 1_245_337,
    attemptId: 1_781_426,
    userId: "learner@example.com",
    assignmentId: 3344,
    grade: 0.9,
    status: LtiSyncStatus.PENDING,
    retryCount: 0,
    errorHistory: [],
    authCookie: launchCookie(),
    ltiGatewayUrl: "http://gateway/grade",
    createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    lastAttemptAt: null,
    attempt: {},
    ...overrides,
  });

  beforeEach(async () => {
    process.env.GRADING_LTI_GATEWAY_URL = "http://gateway/grade";
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LtiGradeSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: HttpService, useValue: http },
        { provide: AdminEmailService, useValue: email },
      ],
    }).compile();
    service = module.get(LtiGradeSyncService);

    jest.clearAllMocks();
    prisma.ltiGradeSync.updateMany.mockResolvedValue({ count: 1 });
    prisma.ltiGradeSync.update.mockResolvedValue({});
    prisma.ltiGradeSync.findMany.mockResolvedValue([]);
    prisma.ltiSyncErrorLog.create.mockResolvedValue({});
    prisma.userNotification.create.mockResolvedValue({});
    http.put.mockReturnValue(of(okResponse));
  });

  describe("createAndSync", () => {
    it("inserts the row already claimed so a crash mid-send leaves a recoverable IN_PROGRESS row", async () => {
      const cookie = launchCookie();
      prisma.ltiGradeSync.create.mockImplementation(
        (arguments_: { data: Record<string, unknown> }) =>
          Promise.resolve({
            id: 7,
            retryCount: 0,
            errorHistory: [],
            attempt: {},
            ...arguments_.data,
          }),
      );

      const result = await service.createAndSync({
        attemptId: 11,
        userId: "learner@example.com",
        assignmentId: 3344,
        grade: 0.9,
        authCookie: cookie,
      });

      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
      expect(prisma.ltiGradeSync.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: LtiSyncStatus.IN_PROGRESS,
            lastAttemptAt: expect.any(Date),
          }),
        }),
      );
      expect(http.put).toHaveBeenCalledTimes(1);
    });
  });

  describe("attemptSync claim", () => {
    it("claims the row atomically and only for orphaned PENDING or stale IN_PROGRESS rows", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(orphan());

      const before = Date.now();
      await service.attemptSync(1_245_337);

      expect(prisma.ltiGradeSync.updateMany).toHaveBeenCalledTimes(1);
      const [{ where, data }] = prisma.ltiGradeSync.updateMany.mock.calls[0];
      expect(where.id).toBe(1_245_337);
      expect(data).toEqual(
        expect.objectContaining({
          status: LtiSyncStatus.IN_PROGRESS,
          lastAttemptAt: expect.any(Date),
        }),
      );

      const staleBefore = (clause: Record<string, { lt?: Date }>) =>
        Object.values(clause).find((value) => value?.lt instanceof Date)?.lt;
      const pending = where.OR.find(
        (clause: { status?: unknown }) =>
          clause.status === LtiSyncStatus.PENDING,
      );
      const inProgress = where.OR.filter(
        (clause: { status?: unknown }) =>
          clause.status === LtiSyncStatus.IN_PROGRESS,
      );
      expect(pending.createdAt.lt.getTime()).toBeLessThanOrEqual(
        before - ORPHANED_SYNC_STALE_MS + 1000,
      );
      expect(inProgress.length).toBeGreaterThan(0);
      for (const clause of inProgress) {
        expect(staleBefore(clause)?.getTime()).toBeLessThanOrEqual(
          before - ORPHANED_SYNC_STALE_MS + 1000,
        );
      }
    });

    it("does not send when another worker holds the row", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(
        orphan({
          status: LtiSyncStatus.IN_PROGRESS,
          lastAttemptAt: new Date(),
        }),
      );
      prisma.ltiGradeSync.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.attemptSync(1_245_337);

      expect(http.put).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.status).toBe(LtiSyncStatus.IN_PROGRESS);
    });

    it("never resends a row that is already SUCCESS", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(
        orphan({ status: LtiSyncStatus.SUCCESS }),
      );

      const result = await service.attemptSync(1_245_337);

      expect(http.put).not.toHaveBeenCalled();
      expect(prisma.ltiGradeSync.updateMany).not.toHaveBeenCalled();
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
    });
  });

  describe("supersession", () => {
    it("closes the row without sending when a newer SUCCESS exists for the same learner, assignment and resource link", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(orphan({ grade: 0.53 }));
      // A relaunch gets a new cookie and, on some LMSes, a new sourcedid. The
      // group and outcome URL still identify the same gradebook column.
      prisma.ltiGradeSync.findMany.mockResolvedValue([
        { id: 1_329_433, grade: 0.8, authCookie: launchCookie() },
      ]);

      const result = await service.attemptSync(1_245_337);

      expect(http.put).not.toHaveBeenCalled();
      expect(prisma.ltiGradeSync.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: "learner@example.com",
            assignmentId: 3344,
            status: LtiSyncStatus.SUCCESS,
            id: { gt: 1_245_337 },
          }),
        }),
      );
      expect(prisma.ltiGradeSync.update).toHaveBeenCalledWith({
        where: { id: 1_245_337 },
        data: expect.objectContaining({
          status: LtiSyncStatus.FAILED,
          lastError: expect.stringContaining("superseded by sync 1329433"),
          nextRetryAt: null,
        }),
      });
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/superseded/i);
      expect(prisma.userNotification.create).not.toHaveBeenCalled();
    });

    it("still sends when the newer SUCCESS belongs to a different course", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(orphan());
      prisma.ltiGradeSync.findMany.mockResolvedValue([
        {
          id: 1_400_000,
          grade: 1,
          authCookie: launchCookie({ groupID: "course-b" }),
        },
      ]);

      const result = await service.attemptSync(1_245_337);

      expect(http.put).toHaveBeenCalledWith(
        "http://gateway/grade",
        { score: 0.9 },
        expect.anything(),
      );
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
    });

    it("still sends when the newer SUCCESS posts to a different outcome service", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(orphan());
      prisma.ltiGradeSync.findMany.mockResolvedValue([
        {
          id: 1_400_000,
          grade: 1,
          authCookie: launchCookie({
            lis_outcome_service_url: "https://other-lms.example.com/outcomes",
          }),
        },
      ]);

      await service.attemptSync(1_245_337);

      expect(http.put).toHaveBeenCalledTimes(1);
    });

    it("sends an orphan whose only SUCCESS rows are older", async () => {
      prisma.ltiGradeSync.findUnique.mockResolvedValue(orphan());
      // findMany is scoped to id > orphan id, so older rows never come back.
      prisma.ltiGradeSync.findMany.mockResolvedValue([]);

      const result = await service.attemptSync(1_245_337);

      expect(http.put).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
    });
  });

  describe("processScheduledRetries", () => {
    it("also picks up orphaned PENDING and stale IN_PROGRESS rows", async () => {
      const before = Date.now();
      prisma.ltiGradeSync.findMany.mockResolvedValueOnce([]);

      await service.processScheduledRetries();

      const [{ where }] = prisma.ltiGradeSync.findMany.mock.calls[0];
      const statuses = where.OR.map(
        (clause: { status: LtiSyncStatus }) => clause.status,
      );
      expect(statuses).toEqual(
        expect.arrayContaining([
          LtiSyncStatus.SCHEDULED,
          LtiSyncStatus.PENDING,
          LtiSyncStatus.IN_PROGRESS,
        ]),
      );
      const pending = where.OR.find(
        (clause: { status: LtiSyncStatus }) =>
          clause.status === LtiSyncStatus.PENDING,
      );
      expect(pending.createdAt.lt.getTime()).toBeLessThanOrEqual(
        before - ORPHANED_SYNC_STALE_MS + 1000,
      );
    });
  });
});
