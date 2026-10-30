import { HttpException, HttpStatus } from "@nestjs/common";
import { AIUsageType } from "@prisma/client";
import { UsageTrackerService } from "./usage-tracking.service";

describe("UsageTrackerService", () => {
  const parentLogger = {
    child: jest.fn(),
  };
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
  };
  const prisma = {
    assignment: {
      findUnique: jest.fn(),
    },
    aIUsage: {
      upsert: jest.fn(),
    },
    aIUsageDaily: {
      upsert: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    parentLogger.child.mockReturnValue(logger);
  });

  it("stores token counters as bigint values", async () => {
    prisma.assignment.findUnique.mockResolvedValue({ id: 123 });
    prisma.aIUsage.upsert.mockResolvedValue({});
    const service = new UsageTrackerService(prisma as any, parentLogger as any);

    await service.trackUsage(
      123,
      AIUsageType.ASSIGNMENT_GRADING,
      11,
      29,
      "gpt-4o-mini",
    );

    expect(prisma.aIUsage.upsert).toHaveBeenCalledWith({
      where: {
        assignmentId_usageType: {
          assignmentId: 123,
          usageType: AIUsageType.ASSIGNMENT_GRADING,
        },
      },
      update: {
        tokensIn: { increment: BigInt(11) },
        tokensOut: { increment: BigInt(29) },
        usageCount: { increment: BigInt(1) },
        updatedAt: expect.any(Date),
        modelKey: "gpt-4o-mini",
      },
      create: {
        assignmentId: 123,
        usageType: AIUsageType.ASSIGNMENT_GRADING,
        tokensIn: BigInt(11),
        tokensOut: BigInt(29),
        usageCount: BigInt(1),
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        modelKey: "gpt-4o-mini",
      },
    });
  });

  describe("daily ledger", () => {
    const ledgerCall = () => {
      const [[call]] = prisma.aIUsageDaily.upsert.mock.calls;
      return call;
    };

    beforeEach(() => {
      prisma.assignment.findUnique.mockResolvedValue({ id: 123 });
      prisma.aIUsage.upsert.mockResolvedValue({});
      prisma.aIUsageDaily.upsert.mockResolvedValue({});
    });

    it("adds the call to the UTC day's row for its type, model and assignment", async () => {
      jest.useFakeTimers({ now: new Date("2026-10-30T23:59:00-04:00") });
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await service.trackUsage(
        123,
        AIUsageType.ASSIGNMENT_GRADING,
        100,
        20,
        "gpt-6-luna",
        { cachedInputTokens: 40 },
      );
      jest.useRealTimers();

      const key = {
        day: new Date("2026-10-31T00:00:00.000Z"),
        usageType: AIUsageType.ASSIGNMENT_GRADING,
        modelKey: "gpt-6-luna",
        assignmentId: 123,
      };
      expect(ledgerCall()).toEqual({
        where: { day_usageType_modelKey_assignmentId: key },
        create: {
          ...key,
          inputTokens: BigInt(100),
          cachedInputTokens: BigInt(40),
          outputTokens: BigInt(20),
          calls: BigInt(1),
          failedCalls: BigInt(0),
        },
        update: {
          inputTokens: { increment: BigInt(100) },
          cachedInputTokens: { increment: BigInt(40) },
          outputTokens: { increment: BigInt(20) },
          calls: { increment: BigInt(1) },
          failedCalls: { increment: BigInt(0) },
        },
      });
    });

    it("counts a billed call that failed", async () => {
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await service.trackUsage(
        123,
        AIUsageType.ASSIGNMENT_GRADING,
        5,
        6,
        "gpt-6-luna",
        { failed: true },
      );
      expect(ledgerCall().update.failedCalls).toEqual({
        increment: BigInt(1),
      });
    });

    it("records a call with no assignment in the ledger alone", async () => {
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await service.trackUsage(
        null,
        AIUsageType.CHAT_ASSISTANT,
        5,
        6,
        "gpt-6-luna",
      );
      expect(ledgerCall().create.assignmentId).toBe(0);
      expect(prisma.aIUsage.upsert).not.toHaveBeenCalled();
    });

    it("still records the spend when the assignment no longer exists", async () => {
      prisma.assignment.findUnique.mockResolvedValue(null);
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await expect(
        service.trackUsage(999, AIUsageType.TRANSLATION, 1, 1, "m"),
      ).rejects.toBeInstanceOf(HttpException);
      expect(ledgerCall().create.assignmentId).toBe(999);
    });

    it("labels a call with no model as unknown rather than dropping it", async () => {
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await service.trackUsage(123, AIUsageType.TRANSLATION, 1, 1);
      expect(ledgerCall().create.modelKey).toBe("unknown");
    });

    it("keeps the per-assignment totals when the ledger write fails, and logs it", async () => {
      prisma.aIUsageDaily.upsert.mockRejectedValue(new Error("ledger down"));
      const service = new UsageTrackerService(
        prisma as any,
        parentLogger as any,
      );
      await service.trackUsage(123, AIUsageType.TRANSLATION, 1, 1, "m");
      expect(prisma.aIUsage.upsert).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("ledger down"),
      );
    });
  });

  it("preserves assignment validation failures", async () => {
    prisma.assignment.findUnique.mockResolvedValue(null);
    const service = new UsageTrackerService(prisma as any, parentLogger as any);

    expect.assertions(3);

    try {
      await service.trackUsage(999, AIUsageType.ASSIGNMENT_GRADING, 1, 1);
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as HttpException).message).toBe(
        "Assignment with ID 999 does not exist",
      );
    }
  });
});
