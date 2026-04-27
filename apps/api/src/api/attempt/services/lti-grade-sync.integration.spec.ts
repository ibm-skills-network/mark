/* eslint-disable */
import { HttpModule, HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncStatus } from "@prisma/client";
import { AxiosResponse } from "axios";
import { of, throwError } from "rxjs";
import { PrismaService } from "../../../database/prisma.service";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";

/**
 * Integration tests for LTI Grade Sync System
 * Tests the complete flow from submission to retry to completion
 */
describe("LtiGradeSyncService - Integration Tests", () => {
  let service: LtiGradeSyncService;
  let prismaService: PrismaService;
  let httpService: HttpService;

  const mockPrismaService = {
    ltiGradeSync: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    ltiSyncErrorLog: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    userNotification: {
      create: jest.fn(),
    },
  };

  const mockHttpService = {
    put: jest.fn(),
  };

  const mockAdminEmailService = {
    sendGenericEmail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    process.env.GRADING_LTI_GATEWAY_URL = "https://test-lti-gateway.com/grades";

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [
        LtiGradeSyncService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: AdminEmailService, useValue: mockAdminEmailService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string) => {
              if (key === "GRADING_LTI_GATEWAY_URL")
                return "https://test-lti-gateway.com/grades";
              if (key === "GRADING_LTI_GATEWAY_TIMEOUT") return undefined;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<LtiGradeSyncService>(LtiGradeSyncService);
    prismaService = module.get<PrismaService>(PrismaService);
    httpService = module.get<HttpService>(HttpService);

    jest.clearAllMocks();
  });

  describe("Complete Success Flow", () => {
    it("should complete full sync flow successfully", async () => {
      const request = {
        attemptId: 1,
        userId: "user-1",
        assignmentId: 10,
        grade: 0.9,
        authCookie: "valid-auth",
      };

      const createdSync = {
        id: 1,
        ...request,
        status: LtiSyncStatus.PENDING,
        retryCount: 0,
        maxRetries: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        errorHistory: [],
        learnerNotified: false,
      };

      mockPrismaService.ltiGradeSync.create.mockResolvedValue(createdSync);

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue({
        ...createdSync,
        attempt: {},
      });

      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) => {
        return Promise.resolve({ ...createdSync, ...arguments_.data });
      });

      const axiosResponse: AxiosResponse = {
        status: 200,
        data: { message: "Grade received" },
        statusText: "OK",
        headers: {},
        config: {} as any,
      };
      mockHttpService.put.mockReturnValue(of(axiosResponse));

      const result = await service.createAndSync(request);

      expect(result.success).toBe(true);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);

      const updateCalls = mockPrismaService.ltiGradeSync.update.mock.calls;

      expect(
        updateCalls.some(
          (call) => call[0].data.status === LtiSyncStatus.IN_PROGRESS,
        ),
      ).toBe(true);

      expect(
        updateCalls.some(
          (call) =>
            call[0].data.status === LtiSyncStatus.SUCCESS &&
            call[0].data.completedAt,
        ),
      ).toBe(true);

      expect(mockHttpService.put).toHaveBeenCalledWith(
        "https://test-lti-gateway.com/grades",
        { score: 0.9 },
        expect.objectContaining({
          headers: { Cookie: "authentication=valid-auth" },
        }),
      );
    });
  });

  describe("Complete Retry Flow", () => {
    it("should handle failure, retry, and eventual success", async () => {
      const request = {
        attemptId: 2,
        userId: "user-2",
        assignmentId: 20,
        grade: 0.75,
        authCookie: "retry-auth",
      };

      const createdSync = {
        id: 2,
        ...request,
        status: LtiSyncStatus.PENDING,
        retryCount: 0,
        maxRetries: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        errorHistory: [],
        learnerNotified: false,
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.create.mockResolvedValue(createdSync);
      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(createdSync);

      let currentRetryCount = 0;
      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) => {
        if (arguments_.data.retryCount !== undefined) {
          currentRetryCount = arguments_.data.retryCount;
        }
        return Promise.resolve({
          ...createdSync,
          retryCount: currentRetryCount,
          ...arguments_.data,
        });
      });

      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValueOnce(
        throwError(() => new Error("Network timeout")),
      );

      const firstResult = await service.createAndSync(request);

      expect(firstResult.success).toBe(false);
      expect(firstResult.status).toBe(LtiSyncStatus.SCHEDULED);
      expect(firstResult.nextRetryAt).toBeDefined();

      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          syncId: 2,
          attemptNumber: 1,
          errorMessage: "Network timeout",
        }),
      });

      expect(mockPrismaService.userNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-2",
          type: "GRADE_SYNC",
          title: "Retrying grade sync",
        }),
      });

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue({
        ...createdSync,
        retryCount: 1,
        status: LtiSyncStatus.SCHEDULED,
      });

      mockHttpService.put.mockReturnValueOnce(
        of({ status: 200 } as AxiosResponse),
      );

      const retryResult = await service.attemptSync(2);

      expect(retryResult.success).toBe(true);
      expect(retryResult.status).toBe(LtiSyncStatus.SUCCESS);
    });
  });

  describe("Complete Failure Flow", () => {
    it("should fail permanently after max retries", async () => {
      const request = {
        attemptId: 3,
        userId: "user-3",
        assignmentId: 30,
        grade: 0.6,
        authCookie: "fail-auth",
      };

      const sync = {
        id: 3,
        ...request,
        status: LtiSyncStatus.PENDING,
        maxRetries: 5,
        errorHistory: [],
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.create.mockResolvedValue(sync);
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => new Error("Persistent failure")),
      );

      for (let index = 0; index < 5; index++) {
        mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue({
          ...sync,
          retryCount: index,
        });

        let updateResult = { ...sync, retryCount: index };
        mockPrismaService.ltiGradeSync.update.mockImplementation(
          (arguments_) => {
            updateResult = { ...updateResult, ...arguments_.data };
            return Promise.resolve(updateResult);
          },
        );

        const result =
          index === 0
            ? await service.createAndSync(request)
            : await service.attemptSync(3);

        if (index < 4) {
          expect(result.status).toBe(LtiSyncStatus.SCHEDULED);
          expect(result.nextRetryAt).toBeDefined();
        } else {
          expect(result.status).toBe(LtiSyncStatus.FAILED);
          expect(result.message).toContain("failed after multiple attempts");
        }
      }

      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalledTimes(5);

      const notifications =
        mockPrismaService.userNotification.create.mock.calls;
      const finalNotification = notifications.at(-1)[0].data;

      expect(finalNotification.title).toBe("Grade sync failed");
      expect(finalNotification.message).toContain("multiple attempts");
    });
  });

  describe("Scheduled Retry Processing", () => {
    it("should process batch of scheduled retries", async () => {
      const now = new Date();

      const scheduledSyncs = [
        {
          id: 10,
          attemptId: 100,
          userId: "user-10",
          grade: 0.8,
          status: LtiSyncStatus.SCHEDULED,
          nextRetryAt: new Date(now.getTime() - 120_000),
          retryCount: 1,
          maxRetries: 5,
          authCookie: "auth-10",
          ltiGatewayUrl: "https://test.com",
          errorHistory: [],
          attempt: {},
        },
        {
          id: 11,
          attemptId: 101,
          userId: "user-11",
          grade: 0.85,
          status: LtiSyncStatus.SCHEDULED,
          nextRetryAt: new Date(now.getTime() - 60_000),
          retryCount: 2,
          maxRetries: 5,
          authCookie: "auth-11",
          ltiGatewayUrl: "https://test.com",
          errorHistory: [],
          attempt: {},
        },
      ];

      mockPrismaService.ltiGradeSync.findMany.mockResolvedValue(scheduledSyncs);

      let callIndex = 0;
      mockPrismaService.ltiGradeSync.findUnique.mockImplementation(() => {
        return Promise.resolve(scheduledSyncs[callIndex++]);
      });

      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockHttpService.put.mockReturnValue(of({ status: 200 } as AxiosResponse));

      const processed = await service.processScheduledRetries();

      expect(processed).toBe(2);
      expect(mockPrismaService.ltiGradeSync.findMany).toHaveBeenCalledWith({
        where: {
          status: LtiSyncStatus.SCHEDULED,
          nextRetryAt: {
            lte: expect.any(Date),
          },
        },
        take: 50,
      });

      expect(mockHttpService.put).toHaveBeenCalledTimes(2);
    });
  });

  describe("Manual Retry Flow", () => {
    it("should allow admin manual retry of failed sync", async () => {
      const failedSync = {
        id: 20,
        attemptId: 200,
        userId: "user-20",
        grade: 0.7,
        status: LtiSyncStatus.FAILED,
        retryCount: 5,
        maxRetries: 5,
        authCookie: "retry-auth",
        ltiGatewayUrl: "https://test.com",
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(failedSync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({
        ...failedSync,
        status: LtiSyncStatus.SUCCESS,
      });
      mockHttpService.put.mockReturnValue(of({ status: 200 } as AxiosResponse));

      const result = await service.manualRetry(20);

      expect(result.success).toBe(true);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
      expect(mockHttpService.put).toHaveBeenCalled();
    });
  });

  describe("System Stats and Monitoring", () => {
    it("should provide accurate system statistics", async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      mockPrismaService.ltiGradeSync.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(145)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(4);

      const stats = await service.getSystemStats();

      expect(stats).toEqual({
        failedCount: 3,
        scheduledCount: 8,
        successCount: 145,
        pendingCount: 2,
        authExpiredCount: 4,
        total: 162,
      });

      expect(mockPrismaService.ltiGradeSync.count).toHaveBeenCalledWith({
        where: {
          status: LtiSyncStatus.FAILED,
          createdAt: { gte: expect.any(Date) },
        },
      });
    });
  });

  describe("Error Scenarios", () => {
    it("should handle database connection errors", async () => {
      mockPrismaService.ltiGradeSync.create.mockRejectedValue(
        new Error("Database connection failed"),
      );

      await expect(
        service.createAndSync({
          attemptId: 999,
          userId: "user-999",
          assignmentId: 999,
          grade: 0.5,
          authCookie: "auth",
        }),
      ).rejects.toThrow("Database connection failed");
    });

    it("should handle malformed HTTP responses", async () => {
      const sync = {
        id: 30,
        attemptId: 300,
        authCookie: "auth",
        ltiGatewayUrl: "https://test.com",
        retryCount: 0,
        maxRetries: 5,
        errorHistory: [],
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(of({} as AxiosResponse));

      const result = await service.attemptSync(30);

      expect(result.success).toBe(false);
      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalled();
    });
  });

  describe("AUTH_EXPIRED end-to-end (BUG-02 / BUG-03)", () => {
    it("createAndSync immediate path: 401 → AUTH_EXPIRED, no retry scheduled", async () => {
      const request = {
        attemptId: 400,
        userId: "auth-expired-user@example.test",
        assignmentId: 40,
        grade: 0.92,
        authCookie: "expired-cookie",
      };

      const createdSync = {
        id: 40,
        ...request,
        status: LtiSyncStatus.PENDING,
        retryCount: 0,
        maxRetries: 5,
        createdAt: new Date(),
        updatedAt: new Date(),
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        errorHistory: [],
        learnerNotified: false,
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.create.mockResolvedValue(createdSync);
      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(createdSync);

      const updateCalls: any[] = [];
      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) => {
        updateCalls.push(arguments_);
        return Promise.resolve({ ...createdSync, ...arguments_.data });
      });

      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => ({
          response: {
            status: 401,
            data: { error: "session expired" },
          },
          message: "Request failed with status code 401",
        })),
      );

      const result = await service.createAndSync(request);

      expect(result.success).toBe(false);
      expect(result.status).toBe(LtiSyncStatus.AUTH_EXPIRED);
      expect(result.nextRetryAt).toBeUndefined();

      // Audit row preserved (D-10)
      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalledTimes(1);

      // The terminal AUTH_EXPIRED update should NOT carry retry side-effects
      const authExpiredUpdate = updateCalls.find(
        (call) => call.data.status === LtiSyncStatus.AUTH_EXPIRED,
      );
      expect(authExpiredUpdate).toBeDefined();
      expect(authExpiredUpdate.data).not.toHaveProperty("retryCount");
      expect(authExpiredUpdate.data).not.toHaveProperty("errorHistory");
      expect(authExpiredUpdate.data).not.toHaveProperty("nextRetryAt");

      // No SCHEDULED transition
      const scheduledUpdate = updateCalls.find(
        (call) => call.data.status === LtiSyncStatus.SCHEDULED,
      );
      expect(scheduledUpdate).toBeUndefined();

      // Single attempt — gateway PUT not retried
      expect(mockHttpService.put).toHaveBeenCalledTimes(1);

      // D-14 notification reaches both helper and email path
      expect(mockPrismaService.userNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: "Grade sync needs your instructor's attention",
        }),
      });
      expect(mockAdminEmailService.sendGenericEmail).toHaveBeenCalledTimes(1);
    });

    it("processScheduledRetries cron path: 403 on SCHEDULED → AUTH_EXPIRED (not FAILED, not bumped retry)", async () => {
      const now = new Date();
      const scheduledSync = {
        id: 41,
        attemptId: 410,
        userId: "scheduled-user@example.test",
        assignmentId: 41,
        grade: 0.78,
        status: LtiSyncStatus.SCHEDULED,
        nextRetryAt: new Date(now.getTime() - 60_000),
        retryCount: 2,
        maxRetries: 5,
        authCookie: "stale-cookie",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        errorHistory: [],
        learnerNotified: false,
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findMany.mockResolvedValue([
        scheduledSync,
      ]);
      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(
        scheduledSync,
      );

      const updateCalls: any[] = [];
      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) => {
        updateCalls.push(arguments_);
        return Promise.resolve({ ...scheduledSync, ...arguments_.data });
      });

      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => ({
          response: { status: 403, data: { error: "forbidden" } },
          message: "Request failed with status code 403",
        })),
      );

      const processed = await service.processScheduledRetries();
      expect(processed).toBe(1);

      const authExpiredUpdate = updateCalls.find(
        (call) => call.data.status === LtiSyncStatus.AUTH_EXPIRED,
      );
      expect(authExpiredUpdate).toBeDefined();
      // retryCount must NOT be incremented to 3 — D-03 lock
      expect(authExpiredUpdate.data).not.toHaveProperty("retryCount");
      // No fallthrough to FAILED
      const failedUpdate = updateCalls.find(
        (call) => call.data.status === LtiSyncStatus.FAILED,
      );
      expect(failedUpdate).toBeUndefined();
      // No fresh SCHEDULED with bumped retry
      const reScheduledUpdate = updateCalls.find(
        (call) => call.data.status === LtiSyncStatus.SCHEDULED,
      );
      expect(reScheduledUpdate).toBeUndefined();
    });

    it("emits lti_gateway_4xx with [REDACTED] body_excerpt on 401 with cookie in body", async () => {
      const sync = {
        id: 42,
        attemptId: 420,
        userId: "redact-user@example.test",
        assignmentId: 42,
        grade: 0.5,
        status: LtiSyncStatus.PENDING,
        retryCount: 0,
        maxRetries: 5,
        authCookie: "auth",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        errorHistory: [],
        learnerNotified: false,
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => ({
          response: {
            status: 401,
            data: { cookie: "secret-session-token", message: "expired" },
          },
          message: "Request failed with status code 401",
        })),
      );

      const warnSpy = jest.spyOn((service as any).logger, "warn");

      await service.attemptSync(42);

      const gatewayWarn = warnSpy.mock.calls.find(
        (call) => call[0] === "lti_gateway_4xx",
      );
      expect(gatewayWarn).toBeDefined();
      const ctx = gatewayWarn?.[1] as {
        status: number;
        body_excerpt: string;
      };
      expect(ctx.status).toBe(401);
      expect(ctx.body_excerpt).toContain("[REDACTED]");
      expect(ctx.body_excerpt).not.toContain("secret-session-token");
    });
  });
});
