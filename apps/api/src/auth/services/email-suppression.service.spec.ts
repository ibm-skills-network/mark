import { EmailSuppressionReason } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { EmailSuppressionService } from "./email-suppression.service";

describe("EmailSuppressionService", () => {
  const prisma = {
    emailSuppression: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const service = new EmailSuppressionService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => jest.clearAllMocks());

  it("matches addresses case-insensitively", async () => {
    prisma.emailSuppression.findUnique.mockResolvedValue({ id: 1 });

    await expect(service.isSuppressed("  Gone@Example.COM ")).resolves.toBe(
      true,
    );
    expect(prisma.emailSuppression.findUnique).toHaveBeenCalledWith({
      where: { email: "gone@example.com" },
      select: { id: true },
    });
  });

  it("reports an unknown address as not suppressed", async () => {
    prisma.emailSuppression.findUnique.mockResolvedValue(null);

    await expect(service.isSuppressed("ok@example.com")).resolves.toBe(false);
  });

  it("lets the send go ahead when the lookup fails", async () => {
    prisma.emailSuppression.findUnique.mockRejectedValue(new Error("db down"));

    await expect(service.isSuppressed("ok@example.com")).resolves.toBe(false);
  });

  it("keeps the first reason when an address is suppressed twice", async () => {
    prisma.emailSuppression.upsert.mockResolvedValue({
      id: 3,
      email: "gone@example.com",
      reason: EmailSuppressionReason.HARD_BOUNCE,
    });

    await service.suppress(
      "Gone@example.com",
      EmailSuppressionReason.MANUAL,
      "x".repeat(800),
      "admin@example.com",
    );

    expect(prisma.emailSuppression.upsert).toHaveBeenCalledWith({
      where: { email: "gone@example.com" },
      create: {
        email: "gone@example.com",
        reason: EmailSuppressionReason.MANUAL,
        detail: "x".repeat(500),
        createdBy: "admin@example.com",
      },
      update: {},
    });
  });

  it("pages and searches the list", async () => {
    prisma.emailSuppression.findMany.mockResolvedValue([]);
    prisma.emailSuppression.count.mockResolvedValue(0);

    await service.list(3, 10, "Example.com");

    expect(prisma.emailSuppression.findMany).toHaveBeenCalledWith({
      where: { email: { contains: "example.com" } },
      orderBy: { createdAt: "desc" },
      skip: 20,
      take: 10,
    });
  });

  it("reports whether a suppression was removed", async () => {
    prisma.emailSuppression.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.remove(3, "admin@example.com")).resolves.toBe(true);

    prisma.emailSuppression.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove(4, "admin@example.com")).resolves.toBe(false);
  });
});
