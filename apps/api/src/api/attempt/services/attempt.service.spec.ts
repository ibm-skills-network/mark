import { AttemptServiceV2 } from "./attempt.service";
import { JobStateService } from "../../../job-queue/job-state.service";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import { AttemptSubmissionService } from "./attempt-submission.service";
import { GradingProgressService } from "./grading-progress.service";
import {
  UserRole,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";

const makeRequest = (userId = "user-1", role = UserRole.LEARNER) =>
  ({
    userSession: {
      userId,
      role,
      gradingCallbackRequired: false,
    },
  }) as unknown as UserSessionRequest;

describe("AttemptServiceV2", () => {
  let service: AttemptServiceV2;
  let mockJobStateService: jest.Mocked<Partial<JobStateService>>;
  let mockJobQueueService: jest.Mocked<Partial<JobQueueService>>;
  let mockSubmissionService: jest.Mocked<Partial<AttemptSubmissionService>>;
  let mockGradingProgressService: jest.Mocked<Partial<GradingProgressService>>;

  beforeEach(() => {
    mockJobStateService = {
      acquireActiveJobLock: jest.fn(),
      createJob: jest.fn(),
      updateJobStatus: jest.fn(),
      getJob: jest.fn(),
    };

    mockJobQueueService = {
      enqueue: jest.fn(),
    };

    mockSubmissionService = {
      updateAssignmentAttempt: jest.fn(),
    };

    mockGradingProgressService = {
      setProgressCallback: jest.fn(),
      removeProgressCallback: jest.fn(),
      markFailed: jest.fn(),
    };

    service = new AttemptServiceV2(
      {} as any,
      mockSubmissionService as any,
      {} as any,
      {} as any,
      {} as any,
      mockJobStateService as any,
      mockJobQueueService as any,
      mockGradingProgressService as any,
    );

    jest.clearAllMocks();
  });

  // ─── Change 1: createGradingJob — atomic lock ─────────────────────────────

  describe("createGradingJob", () => {
    it("creates a new job when no active lock exists", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({
        id: "new-job-id",
        queueName: "mark.attempt",
        jobName: "attempt-grade",
        kind: "attempt-grading",
        userId: "user-1",
        status: "Pending",
        progress: "Grading job created",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await service.createGradingJob(
        10,
        5,
        {} as any,
        "cookie",
        makeRequest(),
      );

      expect(result.gradingJobId).toBe("new-job-id");
      expect(mockJobStateService.acquireActiveJobLock).toHaveBeenCalledTimes(1);
      expect(mockJobStateService.createJob).toHaveBeenCalledTimes(1);
      // reservedId must be provided so active key is not set twice
      expect(mockJobStateService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ reservedId: expect.any(String) }),
      );
    });

    it("returns the existing job id without creating a new one when the lock is held", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(
        "existing-job-id",
      );

      const result = await service.createGradingJob(
        10,
        5,
        {} as any,
        "cookie",
        makeRequest(),
      );

      expect(result.gradingJobId).toBe("existing-job-id");
      expect(mockJobStateService.createJob).not.toHaveBeenCalled();
      expect(result.message).toContain("already running");
    });

    it("passes the same temp uuid as reservedId to createJob after acquiring the lock", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({
        id: "temp-123",
        queueName: "q",
        jobName: "n",
        kind: "k",
        userId: "u",
        status: "Pending",
        progress: "p",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await service.createGradingJob(10, 5, {} as any, "", makeRequest());

      const lockCall = mockJobStateService.acquireActiveJobLock!.mock.calls[0];
      const createCall = mockJobStateService.createJob!.mock.calls[0][0];
      // The temp ID passed to acquireActiveJobLock must equal reservedId
      expect(createCall.reservedId).toBe(lockCall[1]);
    });
  });

  // ─── Change 1: createAuthorGradingJob — atomic lock ──────────────────────

  describe("createAuthorGradingJob", () => {
    it("creates a new author preview job when no lock exists", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({
        id: "author-job-id",
        queueName: "mark.attempt",
        jobName: "attempt-author-preview",
        kind: "attempt-author-preview",
        userId: "author-1",
        status: "Pending",
        progress: "Author preview job created",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await service.createAuthorGradingJob(
        5,
        {} as any,
        "cookie",
        makeRequest("author-1", UserRole.AUTHOR),
      );

      expect(result.gradingJobId).toBe("author-job-id");
      expect(mockJobStateService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId: null,
          reservedId: expect.any(String),
        }),
      );
    });

    it("reuses the existing preview job when the lock is held", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(
        "existing-preview-id",
      );

      const result = await service.createAuthorGradingJob(
        5,
        {} as any,
        "cookie",
        makeRequest("author-1", UserRole.AUTHOR),
      );

      expect(result.gradingJobId).toBe("existing-preview-id");
      expect(mockJobStateService.createJob).not.toHaveBeenCalled();
    });
  });

  // ─── Change 7: processGradingJob — markFailed on failure ─────────────────

  describe("processGradingJob", () => {
    it("marks GradingProgress as FAILED when grading throws for a real attempt", async () => {
      const error = new Error("LLM timeout");
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(error);
      mockJobStateService.updateJobStatus!.mockResolvedValue({} as any);
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-1",
          42,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toThrow("LLM timeout");

      expect(mockGradingProgressService.markFailed).toHaveBeenCalledWith(
        42,
        "LLM timeout",
      );
    });

    it("does not call markFailed for author preview jobs (attemptId = -1)", async () => {
      const error = new Error("Preview failed");
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(error);
      mockJobStateService.updateJobStatus!.mockResolvedValue({} as any);
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-preview",
          -1,
          5,
          {} as any,
          "cookie",
          makeRequest("author-1", UserRole.AUTHOR),
        ),
      ).rejects.toThrow("Preview failed");

      expect(mockGradingProgressService.markFailed).not.toHaveBeenCalled();
    });

    it("marks the job status as Failed and re-throws the error", async () => {
      const error = new Error("DB connection lost");
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(error);
      mockJobStateService.updateJobStatus!.mockResolvedValue({} as any);
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-fail",
          99,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toThrow("DB connection lost");

      // The job state must be updated to Failed
      const failedCall = mockJobStateService.updateJobStatus!.mock.calls.find(
        (call) => call[1].status === "Failed",
      );
      expect(failedCall).toBeDefined();
      expect(failedCall![1].progress).toContain("DB connection lost");
    });

    it("works without GradingProgressService (optional dependency)", async () => {
      // Create service without the optional GradingProgressService
      const serviceWithoutProgress = new AttemptServiceV2(
        {} as any,
        mockSubmissionService as any,
        {} as any,
        {} as any,
        {} as any,
        mockJobStateService as any,
        mockJobQueueService as any,
        undefined,
      );

      const error = new Error("No progress service");
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(error);
      mockJobStateService.updateJobStatus!.mockResolvedValue({} as any);

      await expect(
        serviceWithoutProgress.processGradingJob(
          "job-noprog",
          77,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toThrow("No progress service");

      // Should not crash when progressService is absent
      expect(mockGradingProgressService.markFailed).not.toHaveBeenCalled();
    });
  });
});
