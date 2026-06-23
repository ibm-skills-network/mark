import { NotFoundException } from "@nestjs/common";
import { GradingStatus, LtiSyncStatus } from "@prisma/client";
import { AttemptAdminService } from "./attempt-admin.service";

const prisma = {
  assignmentAttempt: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  gradingProgress: {
    upsert: jest.fn(),
  },
  ltiGradeSync: {
    findFirst: jest.fn(),
  },
  // The service batches the attempt + grading-progress writes in a transaction;
  // run the operations as-is so the per-table mocks still observe their calls.
  $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
};
const ltiGradeSyncService = {
  createAndSync: jest.fn(),
};

const make = () =>
  new AttemptAdminService(prisma as never, ltiGradeSyncService as never);

const attempt = {
  id: 7,
  userId: "user-1",
  assignmentId: 42,
  questionOrder: [1, 2, 3],
};

describe("AttemptAdminService.forcePass", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.assignmentAttempt.findUnique.mockResolvedValue(attempt);
    prisma.assignmentAttempt.findMany.mockResolvedValue([]);
    prisma.assignmentAttempt.update.mockResolvedValue({});
    prisma.gradingProgress.upsert.mockResolvedValue({});
    prisma.ltiGradeSync.findFirst.mockResolvedValue(null);
  });

  it("throws NotFound when the attempt does not exist", async () => {
    prisma.assignmentAttempt.findUnique.mockResolvedValue(null);

    await expect(make().forcePass(7, 100, "admin@x")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.assignmentAttempt.update).not.toHaveBeenCalled();
  });

  it("sets the grade as a 0-1 fraction and marks the attempt submitted", async () => {
    const result = await make().forcePass(7, 100, "admin@x");

    expect(prisma.assignmentAttempt.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { grade: 1, submitted: true, expiresAt: expect.any(Date) },
    });
    // The grade and grading-progress writes must go through one transaction.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: true, grade: 1, submitted: true });
  });

  it("forces grading progress to COMPLETED so stale progress is not shown", async () => {
    await make().forcePass(7, 100, "admin@x");

    expect(prisma.gradingProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { attemptId: 7 },
        create: expect.objectContaining({
          attemptId: 7,
          totalQuestions: 3,
          status: GradingStatus.COMPLETED,
          progress: 100,
        }),
        update: expect.objectContaining({
          status: GradingStatus.COMPLETED,
          progress: 100,
          error: null,
        }),
      }),
    );
  });

  it("honours an explicit gradePercent", async () => {
    await make().forcePass(7, 80, "admin@x");

    expect(prisma.assignmentAttempt.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { grade: 0.8, submitted: true, expiresAt: expect.any(Date) },
    });
  });

  it("skips the LMS sync when the attempt has no prior sync", async () => {
    const result = await make().forcePass(7, 100, "admin@x");

    expect(ltiGradeSyncService.createAndSync).not.toHaveBeenCalled();
    expect(result.lti.attempted).toBe(false);
    expect(result.lti.status).toBeNull();
  });

  it("re-syncs the grade reusing the latest auth cookie", async () => {
    prisma.ltiGradeSync.findFirst.mockResolvedValue({ authCookie: "cookie-1" });
    ltiGradeSyncService.createAndSync.mockResolvedValue({
      status: LtiSyncStatus.SUCCESS,
      message: "ok",
    });

    const result = await make().forcePass(7, 100, "admin@x");

    expect(ltiGradeSyncService.createAndSync).toHaveBeenCalledWith({
      attemptId: 7,
      userId: "user-1",
      assignmentId: 42,
      grade: 1,
      authCookie: "cookie-1",
    });
    expect(result.lti).toMatchObject({
      attempted: true,
      status: LtiSyncStatus.SUCCESS,
    });
  });

  it("pushes the highest grade across the learner's attempts, not the raw one", async () => {
    // A previous attempt already scored higher than this force-pass grade; the
    // LMS gradebook must not regress to the lower value.
    prisma.assignmentAttempt.findMany.mockResolvedValue([
      { grade: 0.9 },
      { grade: 0.6 },
    ]);
    prisma.ltiGradeSync.findFirst.mockResolvedValue({ authCookie: "cookie-1" });
    ltiGradeSyncService.createAndSync.mockResolvedValue({
      status: LtiSyncStatus.SUCCESS,
      message: "ok",
    });

    await make().forcePass(7, 60, "admin@x");

    expect(ltiGradeSyncService.createAndSync).toHaveBeenCalledWith(
      expect.objectContaining({ grade: 0.9 }),
    );
  });

  it("still passes the attempt when the LMS sync throws", async () => {
    prisma.ltiGradeSync.findFirst.mockResolvedValue({ authCookie: "cookie-1" });
    ltiGradeSyncService.createAndSync.mockRejectedValue(
      new Error("gateway down"),
    );

    const result = await make().forcePass(7, 100, "admin@x");

    expect(result.success).toBe(true);
    expect(result.lti).toMatchObject({
      attempted: true,
      status: LtiSyncStatus.FAILED,
    });
    expect(result.lti.message).toContain("gateway down");
  });
});
