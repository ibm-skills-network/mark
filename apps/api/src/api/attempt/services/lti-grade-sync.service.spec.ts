/* eslint-disable */
import { HttpService } from "@nestjs/axios";
import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncStatus } from "@prisma/client";
import { AxiosResponse } from "axios";
import { of, throwError } from "rxjs";
import { PrismaService } from "../../../database/prisma.service";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";

describe("LtiGradeSyncService", () => {
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
      providers: [
        LtiGradeSyncService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: AdminEmailService, useValue: mockAdminEmailService },
      ],
    }).compile();

    service = module.get<LtiGradeSyncService>(LtiGradeSyncService);
    prismaService = module.get<PrismaService>(PrismaService);
    httpService = module.get<HttpService>(HttpService);

    jest.clearAllMocks();
  });

  describe("createAndSync", () => {
    it("should create sync record and attempt immediate sync", async () => {
      const request = {
        attemptId: 123,
        userId: "user-456",
        assignmentId: 789,
        grade: 0.85,
        authCookie: "test-auth-cookie",
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
        attempt: { assignmentId: 789, userId: "user-456" },
      });
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({
        ...createdSync,
        status: LtiSyncStatus.SUCCESS,
      });

      const axiosResponse: AxiosResponse = {
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.put.mockReturnValue(of(axiosResponse));

      const result = await service.createAndSync(request);

      expect(result.success).toBe(true);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
      expect(mockPrismaService.ltiGradeSync.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attemptId: 123,
          userId: "user-456",
          grade: 0.85,
          status: LtiSyncStatus.PENDING,
        }),
      });
    });
  });

  describe("attemptSync - Success Cases", () => {
    it("should successfully sync grade to LTI gateway", async () => {
      const sync = {
        id: 1,
        attemptId: 123,
        userId: "user-456",
        grade: 0.85,
        authCookie: "test-cookie",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        retryCount: 0,
        status: LtiSyncStatus.PENDING,
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({
        ...sync,
        status: LtiSyncStatus.SUCCESS,
      });

      const axiosResponse: AxiosResponse = {
        status: 200,
        data: { message: "Grade received" },
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.put.mockReturnValue(of(axiosResponse));

      const result = await service.attemptSync(1);

      expect(result.success).toBe(true);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
      expect(result.message).toContain("successfully synced");

      expect(mockHttpService.put).toHaveBeenCalledWith(
        "https://test-lti-gateway.com/grades",
        { score: 0.85 },
        {
          headers: {
            Cookie: "authentication=test-cookie",
          },
          timeout: 30_000,
        },
      );

      expect(mockPrismaService.ltiGradeSync.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          status: LtiSyncStatus.IN_PROGRESS,
        }),
      });

      expect(mockPrismaService.ltiGradeSync.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          status: LtiSyncStatus.SUCCESS,
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe("attemptSync - Failure Cases with Retry", () => {
    it("should schedule retry on first failure", async () => {
      const sync = {
        id: 1,
        attemptId: 123,
        userId: "user-456",
        assignmentId: 789,
        grade: 0.85,
        authCookie: "test-cookie",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        retryCount: 0,
        maxRetries: 5,
        status: LtiSyncStatus.PENDING,
        errorHistory: [],
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) => {
        return Promise.resolve({ ...sync, ...arguments_.data });
      });
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => new Error("Network timeout")),
      );

      const result = await service.attemptSync(1);

      expect(result.success).toBe(false);
      expect(result.status).toBe(LtiSyncStatus.SCHEDULED);
      expect(result.nextRetryAt).toBeDefined();
      expect(result.message).toContain("retry scheduled");

      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          syncId: 1,
          attemptNumber: 1,
          errorMessage: "Network timeout",
        }),
      });

      expect(mockPrismaService.ltiGradeSync.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          status: LtiSyncStatus.SCHEDULED,
          retryCount: 1,
          nextRetryAt: expect.any(Date),
        }),
      });

      expect(mockPrismaService.userNotification.create).toHaveBeenCalled();
    });

    it("should use exponential backoff for retries", async () => {
      const retryDelays = [5, 60, 120, 1440, 4320];

      for (const [index, retryDelay] of retryDelays.entries()) {
        const sync = {
          id: 1,
          attemptId: 123,
          userId: "user-456",
          assignmentId: 789,
          grade: 0.85,
          authCookie: "test-cookie",
          ltiGatewayUrl: "https://test-lti-gateway.com/grades",
          retryCount: index,
          maxRetries: 5,
          status: LtiSyncStatus.SCHEDULED,
          errorHistory: [],
          attempt: {},
        };

        mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
        mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) =>
          Promise.resolve({ ...sync, ...arguments_.data }),
        );
        mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
        mockPrismaService.userNotification.create.mockResolvedValue({});

        mockHttpService.put.mockReturnValue(
          throwError(() => new Error("Still failing")),
        );

        const beforeTime = Date.now();
        await service.attemptSync(1);
        const afterTime = Date.now();

        const updateCall =
          mockPrismaService.ltiGradeSync.update.mock.calls.find(
            (call) => call[0].data.nextRetryAt,
          );

        if (updateCall) {
          const nextRetryAt = new Date(updateCall[0].data.nextRetryAt);
          const delayMs = nextRetryAt.getTime() - beforeTime;
          const expectedDelayMs = retryDelay * 60 * 1000;

          expect(delayMs).toBeGreaterThanOrEqual(expectedDelayMs - 1000);
          expect(delayMs).toBeLessThanOrEqual(expectedDelayMs + 1000);
        }

        jest.clearAllMocks();
      }
    });

    it("should mark as FAILED after max retries", async () => {
      const sync = {
        id: 1,
        attemptId: 123,
        userId: "user-456",
        assignmentId: 789,
        grade: 0.85,
        authCookie: "test-cookie",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        retryCount: 4,
        maxRetries: 5,
        status: LtiSyncStatus.SCHEDULED,
        errorHistory: [],
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockImplementation((arguments_) =>
        Promise.resolve({ ...sync, ...arguments_.data }),
      );
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(
        throwError(() => new Error("Final failure")),
      );

      const result = await service.attemptSync(1);

      expect(result.success).toBe(false);
      expect(result.status).toBe(LtiSyncStatus.FAILED);
      expect(result.message).toContain("failed after multiple attempts");

      expect(mockPrismaService.ltiGradeSync.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          status: LtiSyncStatus.FAILED,
          retryCount: 5,
        }),
      });

      expect(mockPrismaService.userNotification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: "GRADE_SYNC",
          title: "Grade sync failed",
        }),
      });
    });
  });

  describe("processScheduledRetries", () => {
    it("should process all due retries", async () => {
      const now = new Date();
      const dueRetries = [
        {
          id: 1,
          status: LtiSyncStatus.SCHEDULED,
          nextRetryAt: new Date(now.getTime() - 60_000),
          authCookie: "cookie1",
          ltiGatewayUrl: "https://test.com",
          attempt: {},
        },
        {
          id: 2,
          status: LtiSyncStatus.SCHEDULED,
          nextRetryAt: new Date(now.getTime() - 30_000),
          authCookie: "cookie2",
          ltiGatewayUrl: "https://test.com",
          attempt: {},
        },
      ];

      mockPrismaService.ltiGradeSync.findMany.mockResolvedValue(dueRetries);
      mockPrismaService.ltiGradeSync.findUnique
        .mockResolvedValueOnce(dueRetries[0])
        .mockResolvedValueOnce(dueRetries[1]);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});

      const axiosResponse: AxiosResponse = {
        status: 200,
        data: {},
        statusText: "OK",
        headers: {},
        config: {} as any,
      };

      mockHttpService.put.mockReturnValue(of(axiosResponse));

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
    });

    it("should handle partial failures in batch", async () => {
      const dueRetries = [
        { id: 1, status: LtiSyncStatus.SCHEDULED, attempt: {} },
        { id: 2, status: LtiSyncStatus.SCHEDULED, attempt: {} },
      ];

      mockPrismaService.ltiGradeSync.findMany.mockResolvedValue(dueRetries);
      mockPrismaService.ltiGradeSync.findUnique
        .mockResolvedValueOnce({
          ...dueRetries[0],
          authCookie: "c1",
          ltiGatewayUrl: "url",
        })
        .mockResolvedValueOnce({
          ...dueRetries[1],
          authCookie: "c2",
          ltiGatewayUrl: "url",
        });
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});

      mockHttpService.put
        .mockReturnValueOnce(of({ status: 200 } as AxiosResponse))
        .mockReturnValueOnce(throwError(() => new Error("Fail")));

      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      const processed = await service.processScheduledRetries();

      expect(processed).toBe(2);
    });

    it("should process maximum 50 syncs per batch", async () => {
      const manyRetries = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        status: LtiSyncStatus.SCHEDULED,
        nextRetryAt: new Date(),
      }));

      mockPrismaService.ltiGradeSync.findMany.mockResolvedValue(
        manyRetries.slice(0, 50),
      );

      mockPrismaService.ltiGradeSync.findUnique.mockImplementation(
        (arguments_) =>
          Promise.resolve({
            id: arguments_.where.id,
            authCookie: "cookie",
            ltiGatewayUrl: "url",
            attempt: {},
          }),
      );
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockHttpService.put.mockReturnValue(of({ status: 200 } as AxiosResponse));

      const processed = await service.processScheduledRetries();

      expect(processed).toBe(50);
      expect(mockPrismaService.ltiGradeSync.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe("getSyncStatus", () => {
    it("should return sync status with error logs", async () => {
      const sync = {
        id: 1,
        status: LtiSyncStatus.SCHEDULED,
        grade: 0.85,
        retryCount: 2,
        maxRetries: 5,
        lastError: "Connection timeout",
        nextRetryAt: new Date(),
        completedAt: null,
        createdAt: new Date(),
        errorLogs: [
          {
            id: 1,
            errorMessage: "First error",
            timestamp: new Date(),
          },
          {
            id: 2,
            errorMessage: "Second error",
            timestamp: new Date(),
          },
        ],
      };

      mockPrismaService.ltiGradeSync.findFirst.mockResolvedValue(sync);

      const status = await service.getSyncStatus(123);

      expect(status).toEqual({
        id: 1,
        status: LtiSyncStatus.SCHEDULED,
        grade: 0.85,
        retryCount: 2,
        maxRetries: 5,
        lastError: "Connection timeout",
        nextRetryAt: sync.nextRetryAt,
        completedAt: null,
        createdAt: sync.createdAt,
        errorLogs: sync.errorLogs,
        canRetry: true,
      });
    });

    it("should return null if no sync found", async () => {
      mockPrismaService.ltiGradeSync.findFirst.mockResolvedValue(null);

      const status = await service.getSyncStatus(999);

      expect(status).toBeNull();
    });
  });

  describe("manualRetry", () => {
    it("should retry a failed sync", async () => {
      const sync = {
        id: 1,
        status: LtiSyncStatus.FAILED,
        authCookie: "cookie",
        ltiGatewayUrl: "url",
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockHttpService.put.mockReturnValue(of({ status: 200 } as AxiosResponse));

      const result = await service.manualRetry(1);

      expect(result.success).toBe(true);
      expect(result.status).toBe(LtiSyncStatus.SUCCESS);
    });

    it("should not retry already successful sync", async () => {
      const sync = {
        id: 1,
        status: LtiSyncStatus.SUCCESS,
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);

      const result = await service.manualRetry(1);

      expect(result.success).toBe(true);
      expect(result.message).toContain("already successfully synced");
      expect(mockHttpService.put).not.toHaveBeenCalled();
    });

    it("should throw if sync not found", async () => {
      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(null);

      await expect(service.manualRetry(999)).rejects.toThrow(
        "Grade sync 999 not found",
      );
    });
  });

  describe("getSystemStats", () => {
    it("should return accurate system statistics", async () => {
      mockPrismaService.ltiGradeSync.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(12)
        .mockResolvedValueOnce(234)
        .mockResolvedValueOnce(3);

      const stats = await service.getSystemStats();

      expect(stats).toEqual({
        failedCount: 5,
        scheduledCount: 12,
        successCount: 234,
        pendingCount: 3,
        total: 254,
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle HTTP errors with status codes", async () => {
      const sync = {
        id: 1,
        attemptId: 123,
        userId: "user-456",
        assignmentId: 789,
        grade: 0.85,
        authCookie: "test-cookie",
        ltiGatewayUrl: "https://test-lti-gateway.com/grades",
        retryCount: 0,
        maxRetries: 5,
        errorHistory: [],
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      const httpError = {
        response: {
          status: 504,
          data: { error: "Gateway timeout" },
        },
        message: "Request timeout",
      };

      mockHttpService.put.mockReturnValue(throwError(() => httpError));

      await service.attemptSync(1);

      expect(mockPrismaService.ltiSyncErrorLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          httpStatus: 504,
          errorMessage: expect.any(String),
        }),
      });
    });

    it("should handle non-200 success responses", async () => {
      const sync = {
        id: 1,
        authCookie: "cookie",
        ltiGatewayUrl: "url",
        retryCount: 0,
        maxRetries: 5,
        errorHistory: [],
        attempt: {},
      };

      mockPrismaService.ltiGradeSync.findUnique.mockResolvedValue(sync);
      mockPrismaService.ltiGradeSync.update.mockResolvedValue({});
      mockPrismaService.ltiSyncErrorLog.create.mockResolvedValue({});
      mockPrismaService.userNotification.create.mockResolvedValue({});

      mockHttpService.put.mockReturnValue(of({ status: 201 } as AxiosResponse));

      const result = await service.attemptSync(1);

      expect(result.success).toBe(false);
    });
  });
});
