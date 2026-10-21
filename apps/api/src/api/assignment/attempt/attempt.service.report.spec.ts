import { NotFoundException } from "@nestjs/common";
import { ReportType } from "@prisma/client";
import { AttemptServiceV1 } from "./attempt.service";

jest.mock("src/job-queue/redis.connection", () => ({
  createCacheRedisConnection: () => {
    throw new Error("no redis in unit tests");
  },
  isRedisReady: () => false,
}));

describe("AttemptServiceV1.createReport", () => {
  const owner = "learner@example.com";
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const parentLogger = { child: jest.fn().mockReturnValue(log) };
  const makeService = (attempt: unknown) => {
    const prisma = {
      assignment: { findUnique: jest.fn().mockResolvedValue({ id: 42 }) },
      assignmentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
      report: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    const service = new AttemptServiceV1(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      parentLogger as never,
    );
    return { service, prisma };
  };
  beforeEach(() => jest.clearAllMocks());

  it("records a report on the reporter's own attempt", async () => {
    const { service, prisma } = makeService({
      id: 84,
      userId: owner,
      assignmentId: 42,
    });

    await service.createReport(42, 84, ReportType.BUG, "Q3 is broken", owner);

    expect(prisma.report.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assignmentId: 42,
        attemptId: 84,
        reporterId: owner,
      }),
    });
  });

  const refused: Array<[string, unknown, number, number]> = [
    [
      "another user's attempt",
      { id: 84, userId: "someone-else@example.com", assignmentId: 42 },
      42,
      84,
    ],
    [
      "an attempt on a different assignment",
      { id: 84, userId: owner, assignmentId: 7 },
      42,
      84,
    ],
    ["an attempt that does not exist", null, 42, 84],
    ["a non-numeric attempt id", null, 42, Number.NaN],
  ];

  it.each(refused)(
    "refuses %s with the same generic error",
    async (_name, attempt, assignmentId, attemptId) => {
      const { service, prisma } = makeService(attempt);

      const call = service.createReport(
        assignmentId,
        attemptId,
        ReportType.BUG,
        "text",
        owner,
      );

      await expect(call).rejects.toThrow(NotFoundException);
      await expect(call).rejects.toThrow("Assignment attempt not found");
      expect(prisma.report.create).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        "createReport: attempt not reportable by this user",
        expect.objectContaining({ user_id: owner, attempt_id: attemptId }),
      );
    },
  );
});
