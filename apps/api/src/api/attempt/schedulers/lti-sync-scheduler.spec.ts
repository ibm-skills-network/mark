import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncScheduler } from "./lti-sync-scheduler";
import { LtiGradeSyncService } from "../services/lti-grade-sync.service";

describe("LtiSyncScheduler", () => {
  let scheduler: LtiSyncScheduler;
  let ltiGradeSyncService: LtiGradeSyncService;
  const originalEnableJobSchedulers = process.env.ENABLE_JOB_SCHEDULERS;
  let loggerSpies: {
    debug: jest.SpyInstance;
    error: jest.SpyInstance;
    log: jest.SpyInstance;
    warn: jest.SpyInstance;
  };

  const mockLtiGradeSyncService = {
    processScheduledRetries: jest.fn(),
    getSystemStats: jest.fn(),
  };

  beforeEach(async () => {
    process.env.ENABLE_JOB_SCHEDULERS = "true";

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LtiSyncScheduler,
        {
          provide: LtiGradeSyncService,
          useValue: mockLtiGradeSyncService,
        },
      ],
    }).compile();

    scheduler = module.get<LtiSyncScheduler>(LtiSyncScheduler);
    ltiGradeSyncService = module.get<LtiGradeSyncService>(LtiGradeSyncService);
    loggerSpies = {
      debug: jest
        .spyOn((scheduler as any).logger, "debug")
        .mockImplementation(() => undefined),
      error: jest
        .spyOn((scheduler as any).logger, "error")
        .mockImplementation(() => undefined),
      log: jest
        .spyOn((scheduler as any).logger, "log")
        .mockImplementation(() => undefined),
      warn: jest
        .spyOn((scheduler as any).logger, "warn")
        .mockImplementation(() => undefined),
    };

    jest.clearAllMocks();
  });

  afterEach(() => {
    loggerSpies.debug.mockRestore();
    loggerSpies.error.mockRestore();
    loggerSpies.log.mockRestore();
    loggerSpies.warn.mockRestore();

    if (originalEnableJobSchedulers === undefined) {
      delete process.env.ENABLE_JOB_SCHEDULERS;
    } else {
      process.env.ENABLE_JOB_SCHEDULERS = originalEnableJobSchedulers;
    }
  });

  describe("handleScheduledRetries", () => {
    it("should process scheduled retries", async () => {
      mockLtiGradeSyncService.processScheduledRetries.mockResolvedValue(5);

      await scheduler.handleScheduledRetries();

      expect(
        mockLtiGradeSyncService.processScheduledRetries,
      ).toHaveBeenCalled();
    });

    it("should prevent overlapping executions", async () => {
      let resolveFirst: () => void;
      const firstCall = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      mockLtiGradeSyncService.processScheduledRetries.mockReturnValue(
        firstCall,
      );

      const firstPromise = scheduler.handleScheduledRetries();

      await scheduler.handleScheduledRetries();

      expect(
        mockLtiGradeSyncService.processScheduledRetries,
      ).toHaveBeenCalledTimes(1);

      resolveFirst();
      await firstPromise;
    });

    it("should handle errors gracefully", async () => {
      mockLtiGradeSyncService.processScheduledRetries.mockRejectedValue(
        new Error("Database error"),
      );

      await expect(scheduler.handleScheduledRetries()).resolves.not.toThrow();
      expect(loggerSpies.error).toHaveBeenCalled();
    });

    it("should reset processing flag after completion", async () => {
      mockLtiGradeSyncService.processScheduledRetries.mockResolvedValue(3);

      await scheduler.handleScheduledRetries();

      await scheduler.handleScheduledRetries();

      expect(
        mockLtiGradeSyncService.processScheduledRetries,
      ).toHaveBeenCalledTimes(2);
    });

    it("should reset processing flag after error", async () => {
      mockLtiGradeSyncService.processScheduledRetries.mockRejectedValueOnce(
        new Error("First error"),
      );
      mockLtiGradeSyncService.processScheduledRetries.mockResolvedValueOnce(5);

      await scheduler.handleScheduledRetries();
      await scheduler.handleScheduledRetries();

      expect(
        mockLtiGradeSyncService.processScheduledRetries,
      ).toHaveBeenCalledTimes(2);
      expect(loggerSpies.error).toHaveBeenCalledTimes(1);
    });
  });

  describe("reportSyncHealth", () => {
    it("should report stats when syncs processed", async () => {
      mockLtiGradeSyncService.getSystemStats.mockResolvedValue({
        failedCount: 2,
        scheduledCount: 5,
        successCount: 100,
        pendingCount: 1,
        total: 108,
      });

      await scheduler.reportSyncHealth();

      expect(mockLtiGradeSyncService.getSystemStats).toHaveBeenCalled();
    });

    it("should warn on high failure count", async () => {
      mockLtiGradeSyncService.getSystemStats.mockResolvedValue({
        failedCount: 15,
        scheduledCount: 5,
        successCount: 100,
        pendingCount: 0,
        total: 120,
      });

      await scheduler.reportSyncHealth();

      expect(loggerSpies.warn).toHaveBeenCalled();
    });

    it("should warn on high scheduled count", async () => {
      mockLtiGradeSyncService.getSystemStats.mockResolvedValue({
        failedCount: 0,
        scheduledCount: 15,
        successCount: 100,
        pendingCount: 0,
        total: 115,
      });

      await scheduler.reportSyncHealth();

      expect(loggerSpies.warn).toHaveBeenCalled();
    });

    it("should handle getSystemStats errors", async () => {
      mockLtiGradeSyncService.getSystemStats.mockRejectedValue(
        new Error("Stats error"),
      );

      await expect(scheduler.reportSyncHealth()).resolves.not.toThrow();
      expect(loggerSpies.error).toHaveBeenCalled();
    });

    it("should skip scheduled work when schedulers are disabled", async () => {
      process.env.ENABLE_JOB_SCHEDULERS = "false";

      await scheduler.reportSyncHealth();
      await scheduler.handleScheduledRetries();

      expect(mockLtiGradeSyncService.getSystemStats).not.toHaveBeenCalled();
      expect(
        mockLtiGradeSyncService.processScheduledRetries,
      ).not.toHaveBeenCalled();
    });

    it('should skip both cron methods when ENABLE_LTI_SCHEDULER is "false" even if ENABLE_JOB_SCHEDULERS is "true"', async () => {
      const originalLti = process.env.ENABLE_LTI_SCHEDULER;
      const originalJobs = process.env.ENABLE_JOB_SCHEDULERS;
      try {
        process.env.ENABLE_LTI_SCHEDULER = "false";
        process.env.ENABLE_JOB_SCHEDULERS = "true";

        await scheduler.reportSyncHealth();
        await scheduler.handleScheduledRetries();

        expect(mockLtiGradeSyncService.getSystemStats).not.toHaveBeenCalled();
        expect(
          mockLtiGradeSyncService.processScheduledRetries,
        ).not.toHaveBeenCalled();
      } finally {
        if (originalLti === undefined) delete process.env.ENABLE_LTI_SCHEDULER;
        else process.env.ENABLE_LTI_SCHEDULER = originalLti;
        if (originalJobs === undefined)
          delete process.env.ENABLE_JOB_SCHEDULERS;
        else process.env.ENABLE_JOB_SCHEDULERS = originalJobs;
      }
    });

    it('should run scheduled work when ENABLE_LTI_SCHEDULER is unset and ENABLE_JOB_SCHEDULERS is "true"', async () => {
      const originalLti = process.env.ENABLE_LTI_SCHEDULER;
      const originalJobs = process.env.ENABLE_JOB_SCHEDULERS;
      try {
        delete process.env.ENABLE_LTI_SCHEDULER;
        process.env.ENABLE_JOB_SCHEDULERS = "true";

        await scheduler.handleScheduledRetries();

        expect(
          mockLtiGradeSyncService.processScheduledRetries,
        ).toHaveBeenCalled();
      } finally {
        if (originalLti === undefined) delete process.env.ENABLE_LTI_SCHEDULER;
        else process.env.ENABLE_LTI_SCHEDULER = originalLti;
        if (originalJobs === undefined)
          delete process.env.ENABLE_JOB_SCHEDULERS;
        else process.env.ENABLE_JOB_SCHEDULERS = originalJobs;
      }
    });
  });
});
