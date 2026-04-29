import { Test, TestingModule } from "@nestjs/testing";
import { GradingProgressService } from "../grading-progress.service";
import { PrismaService } from "../../../../database/prisma.service";
import { AdminEmailService } from "../../../../auth/services/admin-email.service";

type ProgressCallbackMap = Map<
  string,
  (status: string, progress: string, percentage?: number) => Promise<void>
>;

interface PrivateCallbackAccess {
  progressCallbacks: ProgressCallbackMap;
}

describe("GradingProgressService — composite-keyed callback Map (regrade-while-grading)", () => {
  let service: GradingProgressService;
  let prismaServiceMock: {
    gradingProgress: {
      upsert: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
  };
  let adminEmailServiceMock: { sendGradingCompletionEmail: jest.Mock };

  const privateMap = (): ProgressCallbackMap =>
    (service as unknown as PrivateCallbackAccess).progressCallbacks;

  beforeEach(async () => {
    prismaServiceMock = {
      gradingProgress: {
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({
          attempt: { assignmentId: 7, grade: 0.85 },
          notifyOnComplete: false,
          notificationEmail: null,
        }),
      },
    };
    adminEmailServiceMock = {
      sendGradingCompletionEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingProgressService,
        { provide: PrismaService, useValue: prismaServiceMock },
        { provide: AdminEmailService, useValue: adminEmailServiceMock },
      ],
    }).compile();

    service = module.get<GradingProgressService>(GradingProgressService);
  });

  it("regrade-while-grading: two callbacks for the same attemptId different jobIds coexist", async () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    service.setProgressCallback(42, "job-A", cbA);
    service.setProgressCallback(42, "job-B", cbB);

    const keys = [...privateMap().keys()];
    expect(keys).toContain("42:job-A");
    expect(keys).toContain("42:job-B");
    expect(keys.length).toBe(2);

    // Fire an update for jobId A; only cbA should receive it.
    await service.updateProgress(42, "job-A", {
      currentStage: "Grading question 1...",
      progress: 25,
    });
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbA).toHaveBeenCalledWith("Processing", "Grading question 1...", 25);
    expect(cbB).not.toHaveBeenCalled();

    // Fire an update for jobId B; only cbB should receive it.
    await service.updateProgress(42, "job-B", {
      currentStage: "Regrading question 1...",
      progress: 25,
    });
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbB).toHaveBeenCalledWith(
      "Processing",
      "Regrading question 1...",
      25,
    );
    expect(cbA).toHaveBeenCalledTimes(1); // unchanged
  });

  it("removeProgressCallback isolation: removing jobId A leaves jobId B intact", () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    service.setProgressCallback(42, "job-A", cbA);
    service.setProgressCallback(42, "job-B", cbB);

    service.removeProgressCallback(42, "job-A");

    const keys = [...privateMap().keys()];
    expect(keys).toEqual(["42:job-B"]);
  });

  it("markComplete isolation: markComplete(jobId A) removes A but leaves B", async () => {
    const cbA = jest.fn();
    const cbB = jest.fn();
    service.setProgressCallback(42, "job-A", cbA);
    service.setProgressCallback(42, "job-B", cbB);

    await service.markComplete(42, "job-A");

    const keys = [...privateMap().keys()];
    expect(keys).toEqual(["42:job-B"]);
  });

  it("markFailed cleanup: markFailed removes the Map entry for that (attemptId, jobId) pair", async () => {
    const cbA = jest.fn();
    service.setProgressCallback(42, "job-A", cbA);

    await service.markFailed(42, "job-A", "test error");

    const keys = [...privateMap().keys()];
    expect(keys).not.toContain("42:job-A");
    expect(keys.length).toBe(0);
  });

  it("composite-key shape contract: Map keys MUST match `${attemptId}:${jobId}` literal pattern", () => {
    service.setProgressCallback(42, "abc-123-def-456", jest.fn());
    const keys = [...privateMap().keys()];
    expect(keys[0]).toBe("42:abc-123-def-456");
  });
});
