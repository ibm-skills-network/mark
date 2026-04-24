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
