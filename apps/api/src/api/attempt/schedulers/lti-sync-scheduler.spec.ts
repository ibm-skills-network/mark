import { Test, TestingModule } from "@nestjs/testing";
import { LtiSyncScheduler } from "./lti-sync-scheduler";
import { LtiGradeSyncService } from "../services/lti-grade-sync.service";

describe("LtiSyncScheduler", () => {
  let scheduler: LtiSyncScheduler;
  let ltiGradeSyncService: LtiGradeSyncService;

  const mockLtiGradeSyncService = {
    processScheduledRetries: jest.fn(),
    getSystemStats: jest.fn(),
  };

  beforeEach(async () => {
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

    jest.clearAllMocks();
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
      const warnSpy = jest.spyOn(scheduler["logger"], "warn");

      mockLtiGradeSyncService.getSystemStats.mockResolvedValue({
        failedCount: 15,
        scheduledCount: 5,
        successCount: 100,
        pendingCount: 0,
        total: 120,
      });

      await scheduler.reportSyncHealth();

      expect(warnSpy).toHaveBeenCalled();
    });

    it("should warn on high scheduled count", async () => {
      const warnSpy = jest.spyOn(scheduler["logger"], "warn");

      mockLtiGradeSyncService.getSystemStats.mockResolvedValue({
        failedCount: 0,
        scheduledCount: 15,
        successCount: 100,
        pendingCount: 0,
        total: 115,
      });

      await scheduler.reportSyncHealth();

      expect(warnSpy).toHaveBeenCalled();
    });

    it("should handle getSystemStats errors", async () => {
      mockLtiGradeSyncService.getSystemStats.mockRejectedValue(
        new Error("Stats error"),
      );

      await expect(scheduler.reportSyncHealth()).resolves.not.toThrow();
    });
  });
});
