import { Logger, NotFoundException } from "@nestjs/common";
import { ReportType } from "@prisma/client";
import { AttemptReportingService } from "../attempt-reporting.service";

describe("AttemptReportingService.createReport", () => {
  const owner = "learner@example.com";
  const makePrisma = (attempt: unknown) => ({
    assignment: { findUnique: jest.fn().mockResolvedValue({ id: 42 }) },
    assignmentAttempt: { findUnique: jest.fn().mockResolvedValue(attempt) },
    report: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
  });
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it("records a report on the reporter's own attempt", async () => {
    const prisma = makePrisma({ id: 84, userId: owner, assignmentId: 42 });
    const service = new AttemptReportingService(prisma as never);

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
      const prisma = makePrisma(attempt);
      const service = new AttemptReportingService(prisma as never);

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
      expect(warn).toHaveBeenCalledWith(
        "createReport: attempt not reportable by this user",
        expect.objectContaining({ user_id: owner, attempt_id: attemptId }),
      );
    },
  );
});
