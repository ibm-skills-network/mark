import { GradingStatus } from "@prisma/client";
import { AdminEmailService } from "../../../auth/services/admin-email.service";
import { PrismaService } from "../../../database/prisma.service";
import { GradingProgressService } from "./grading-progress.service";

describe("GradingProgressService stale AI feedback rerun cleanup", () => {
  const originalSchedulers = process.env.ENABLE_JOB_SCHEDULERS;
  const originalThreshold =
    process.env.AI_FEEDBACK_RERUN_STALE_PROCESSING_MINUTES;

  const mockPrisma = {
    gradingProgress: {
      updateMany: jest.fn(),
    },
  };

  const mockEmailService = {
    sendGradingCompletionEmail: jest.fn(),
  };

  let service: GradingProgressService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ENABLE_JOB_SCHEDULERS = "true";
    process.env.AI_FEEDBACK_RERUN_STALE_PROCESSING_MINUTES = "15";
    mockPrisma.gradingProgress.updateMany.mockResolvedValue({ count: 0 });
    service = new GradingProgressService(
      mockPrisma as unknown as PrismaService,
      mockEmailService as unknown as AdminEmailService,
    );
  });

  afterAll(() => {
    if (originalSchedulers === undefined) {
      delete process.env.ENABLE_JOB_SCHEDULERS;
    } else {
      process.env.ENABLE_JOB_SCHEDULERS = originalSchedulers;
    }

    if (originalThreshold === undefined) {
      delete process.env.AI_FEEDBACK_RERUN_STALE_PROCESSING_MINUTES;
    } else {
      process.env.AI_FEEDBACK_RERUN_STALE_PROCESSING_MINUTES =
        originalThreshold;
    }
  });

  it("restores stale retry locks without touching normal processing rows", async () => {
    mockPrisma.gradingProgress.updateMany.mockResolvedValue({ count: 2 });

    const count = await service.cleanupStaleAiFeedbackReruns();

    expect(count).toBe(2);
    expect(mockPrisma.gradingProgress.updateMany).toHaveBeenCalledWith({
      where: {
        status: GradingStatus.PROCESSING,
        error: { not: null },
        updatedAt: { lt: expect.any(Date) },
      },
      data: {
        status: GradingStatus.COMPLETED,
        progress: 100,
        currentStage: "Grading complete!",
      },
    });
  });

  it("skips cleanup when schedulers are disabled", async () => {
    process.env.ENABLE_JOB_SCHEDULERS = "false";

    const count = await service.cleanupStaleAiFeedbackReruns();

    expect(count).toBe(0);
    expect(mockPrisma.gradingProgress.updateMany).not.toHaveBeenCalled();
  });
});
