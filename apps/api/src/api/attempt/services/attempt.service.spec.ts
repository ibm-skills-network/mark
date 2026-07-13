import { AttemptServiceV2 } from "./attempt.service";
import { JobStateService } from "../../../job-queue/job-state.service";
import { JobQueueService } from "../../../job-queue/job-queue.service";
import { OversizedSubmissionError } from "../../llm/features/grading/errors/oversized-submission.error";
import { UnsupportedImageFormatError } from "../../llm/features/grading/errors/unsupported-image-format.error";
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

const request = makeRequest("author-1", UserRole.AUTHOR);
const updateDto = {
  submitted: true,
  responsesForQuestions: [],
};

describe("AttemptServiceV2", () => {
  let service: AttemptServiceV2;
  let mockPrisma: { assignmentAttempt: { findUnique: jest.Mock } };
  let mockJobStateService: jest.Mocked<Partial<JobStateService>>;
  let mockJobQueueService: jest.Mocked<Partial<JobQueueService>>;
  let mockSubmissionService: jest.Mocked<Partial<AttemptSubmissionService>>;
  let mockGradingProgressService: jest.Mocked<Partial<GradingProgressService>>;

  beforeEach(() => {
    mockPrisma = {
      assignmentAttempt: {
        findUnique: jest.fn(),
      },
    };

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
      mockPrisma as any,
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
        "standard",
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
        "standard",
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

      await service.createGradingJob(
        10,
        5,
        {} as any,
        "",
        makeRequest(),
        "standard",
      );

      const lockCall = mockJobStateService.acquireActiveJobLock!.mock.calls[0];
      const createCall = mockJobStateService.createJob!.mock.calls[0][0];
      // The temp ID passed to acquireActiveJobLock must equal reservedId
      expect(createCall.reservedId).toBe(lockCall[1]);
    });

    it("routes standard-tier grading to mark.attempt", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({ id: "job-1" } as any);

      const result = await service.createGradingJob(
        7,
        3,
        {} as any,
        "",
        makeRequest(),
        "standard",
      );

      expect(result.queueName).toBe("mark.attempt");
      expect(mockJobStateService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ queueName: "mark.attempt" }),
      );
    });

    it("routes heavy-tier grading to mark.attempt.heavy", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({ id: "job-1" } as any);

      const result = await service.createGradingJob(
        7,
        3,
        {} as any,
        "",
        makeRequest(),
        "heavy",
      );

      expect(result.queueName).toBe("mark.attempt.heavy");
      expect(mockJobStateService.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ queueName: "mark.attempt.heavy" }),
      );
    });
  });

  // ─── enqueueGradingJob — routes to the queue it is told ──────────────────

  describe("enqueueGradingJob", () => {
    it("enqueues on the queue it is told to", async () => {
      mockJobQueueService.enqueue!.mockResolvedValue(undefined);

      await service.enqueueGradingJob(
        "job-1",
        7,
        3,
        {} as any,
        "",
        makeRequest(),
        "mark.attempt.heavy",
      );

      expect(mockJobQueueService.enqueue).toHaveBeenCalledWith(
        "mark.attempt.heavy",
        "attempt.grade",
        expect.anything(),
        expect.objectContaining({ jobId: "job-1" }),
      );
    });
  });

  // ─── classifyLearnerAttemptTier — tier lookup from pinned version ────────

  describe("classifyLearnerAttemptTier", () => {
    it("classifies from the attempt's pinned question versions", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue({
        assignmentVersion: {
          questionVersions: [{ type: "UPLOAD" }, { type: "TEXT" }],
        },
      });

      await expect(service.classifyLearnerAttemptTier(7)).resolves.toBe(
        "heavy",
      );
    });

    it("falls back to standard when the attempt has no version data", async () => {
      mockPrisma.assignmentAttempt.findUnique.mockResolvedValue(null);

      await expect(service.classifyLearnerAttemptTier(7)).resolves.toBe(
        "standard",
      );
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

    it("reuses the running job's own queue on lock reuse, even when the freshly computed tier differs (mid-flight tier flip)", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(
        "existing-preview-id",
      );
      // The in-flight job is running on mark.attempt (standard tier), but
      // the author has since edited the question set to include an UPLOAD
      // question, which would freshly classify as heavy (mark.attempt.heavy).
      mockJobStateService.getJob!.mockResolvedValue({
        id: "existing-preview-id",
        queueName: "mark.attempt",
        jobName: "attempt-author-preview",
        kind: "attempt-author-preview",
        userId: "author-1",
        status: "Processing",
        progress: "Grading in progress",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await service.createAuthorGradingJob(
        3,
        { ...updateDto, authorQuestions: [{ type: "UPLOAD" }] } as never,
        "",
        request,
      );

      // Must return the existing job's own queue, not the freshly computed
      // one — enqueueing the reused jobId onto a different queue would miss
      // BullMQ's same-jobId dedup (which only applies within one queue) and
      // let the job run twice concurrently.
      expect(result.queueName).toBe("mark.attempt");
      expect(mockJobStateService.getJob).toHaveBeenCalledWith(
        "existing-preview-id",
      );
    });

    it("routes author previews with file questions to the heavy queue", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({ id: "job-2" });
      const result = await service.createAuthorGradingJob(
        3,
        { ...updateDto, authorQuestions: [{ type: "UPLOAD" }] } as never,
        "",
        request,
      );
      expect(result.queueName).toBe("mark.attempt.heavy");
    });

    it("routes MCQ-only author previews to the standard queue (previews never inline)", async () => {
      mockJobStateService.acquireActiveJobLock!.mockResolvedValue(null);
      mockJobStateService.createJob!.mockResolvedValue({ id: "job-2" });
      const result = await service.createAuthorGradingJob(
        3,
        {
          ...updateDto,
          authorQuestions: [{ type: "SINGLE_CORRECT" }],
        } as never,
        "",
        request,
      );
      expect(result.queueName).toBe("mark.attempt");
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

    it("reports the learner-facing message and rethrows when the submission is oversized", async () => {
      const oversized = new OversizedSubmissionError({
        blockCount: 60_000,
        cap: 50_000,
        filename: "huge.xlsx",
      });
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(
        oversized,
      );
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      const updateStatusSpy = jest
        .spyOn(service, "updateGradingJobStatus")
        .mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-oversized",
          42,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toBe(oversized);

      expect(updateStatusSpy).toHaveBeenCalledWith("job-oversized", {
        status: "Failed",
        progress: oversized.learnerMessage,
        percentage: 0,
      });
      expect(mockGradingProgressService.markFailed).toHaveBeenCalledWith(
        42,
        oversized.learnerMessage,
      );
    });

    it("reports the learner-facing message and rethrows for an unsupported image format", async () => {
      const unsupported = new UnsupportedImageFormatError({
        filename: "photo.heic",
        detectedFormat: "image/heic",
        reason: "unsupported format detected at submission",
      });
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(
        unsupported,
      );
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      const updateStatusSpy = jest
        .spyOn(service, "updateGradingJobStatus")
        .mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-unsupported",
          42,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toBe(unsupported);

      expect(updateStatusSpy).toHaveBeenCalledWith("job-unsupported", {
        status: "Failed",
        progress: unsupported.learnerMessage,
        percentage: 0,
      });
      expect(mockGradingProgressService.markFailed).toHaveBeenCalledWith(
        42,
        unsupported.learnerMessage,
      );
    });

    it("reports the technical message for a generic grading failure", async () => {
      const error = new Error("boom");
      mockSubmissionService.updateAssignmentAttempt!.mockRejectedValue(error);
      mockGradingProgressService.setProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.removeProgressCallback!.mockImplementation(
        () => undefined,
      );
      mockGradingProgressService.markFailed!.mockResolvedValue(undefined);

      const updateStatusSpy = jest
        .spyOn(service, "updateGradingJobStatus")
        .mockResolvedValue(undefined);

      await expect(
        service.processGradingJob(
          "job-generic",
          42,
          5,
          {} as any,
          "cookie",
          makeRequest(),
        ),
      ).rejects.toThrow("boom");

      expect(updateStatusSpy).toHaveBeenCalledWith("job-generic", {
        status: "Failed",
        progress: "Grading failed: boom",
        percentage: 0,
      });
      expect(mockGradingProgressService.markFailed).toHaveBeenCalledWith(
        42,
        "boom",
      );
    });
  });
});
