import { Logger } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { SavedSessionsService } from "./saved-sessions.service";

const key = {
  storeId: "7f0c6c1e-3c1a-4c55-9a8e-2b8f6f1d0a11",
  role: "learner" as const,
  assignmentId: 4892,
};

describe("SavedSessionsService", () => {
  const savedSession = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  };
  const service = new SavedSessionsService({
    savedSession,
  } as unknown as PrismaService);
  const environment = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    process.env.ENABLE_JOB_SCHEDULERS = "true";
    delete process.env.SAVED_SESSION_RETENTION_DAYS;
  });

  afterAll(() => {
    process.env = environment;
  });

  it("finds the token for a key", async () => {
    savedSession.findUnique.mockResolvedValue({ token: "jwt" });
    await expect(service.find(key)).resolves.toBe("jwt");
    expect(savedSession.findUnique).toHaveBeenCalledWith({
      where: { storeId_role_assignmentId: key },
      select: { token: true },
    });
  });

  it("returns undefined for a missing key", async () => {
    savedSession.findUnique.mockResolvedValue(null);
    await expect(service.find(key)).resolves.toBeUndefined();
  });

  it("upserts the token for a key", async () => {
    await service.save(key, "jwt");
    expect(savedSession.upsert).toHaveBeenCalledWith({
      where: { storeId_role_assignmentId: key },
      create: { ...key, token: "jwt" },
      update: { token: "jwt" },
    });
  });

  describe("prune", () => {
    const cutoffDays = () => {
      const [[{ where }]] = savedSession.deleteMany.mock.calls as [
        [{ where: { updatedAt: { lt: Date } } }],
      ];
      return (Date.now() - where.updatedAt.lt.getTime()) / 86_400_000;
    };

    it("deletes sessions older than 3 days by default", async () => {
      savedSession.deleteMany.mockResolvedValue({ count: 2 });
      await service.prune();
      expect(cutoffDays()).toBeCloseTo(3, 3);
    });

    it("uses SAVED_SESSION_RETENTION_DAYS when it is positive", async () => {
      process.env.SAVED_SESSION_RETENTION_DAYS = "7";
      savedSession.deleteMany.mockResolvedValue({ count: 0 });
      await service.prune();
      expect(cutoffDays()).toBeCloseTo(7, 3);
    });

    it.each(["0", "-1", "soon"])(
      "falls back to 3 days for SAVED_SESSION_RETENTION_DAYS=%s",
      async (value) => {
        process.env.SAVED_SESSION_RETENTION_DAYS = value;
        savedSession.deleteMany.mockResolvedValue({ count: 0 });
        await service.prune();
        expect(cutoffDays()).toBeCloseTo(3, 3);
      },
    );

    it("does nothing when schedulers are disabled", async () => {
      process.env.ENABLE_JOB_SCHEDULERS = "false";
      await service.prune();
      expect(savedSession.deleteMany).not.toHaveBeenCalled();
    });

    it("logs instead of throwing when the delete fails", async () => {
      savedSession.deleteMany.mockRejectedValue(new Error("db down"));
      await expect(service.prune()).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
