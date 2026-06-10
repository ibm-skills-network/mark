import "reflect-metadata";
import { NotFoundException } from "@nestjs/common";
import { AdminGuard } from "src/auth/guards/admin.guard";
import { QueueStatusController } from "./queue-status.controller";

const service = {
  getAllWorkerHeartbeats: jest.fn().mockResolvedValue([]),
  getQueueStats: jest.fn().mockResolvedValue([]),
  getWorkers: jest.fn().mockResolvedValue([]),
  getFailedJobs: jest.fn().mockResolvedValue([]),
  getActiveJobs: jest.fn().mockResolvedValue([]),
  getRedisHealth: jest.fn().mockResolvedValue({}),
  retryFailedJob: jest.fn(),
  removeFailedJob: jest.fn(),
};

const make = () => new QueueStatusController(service as never);
const req = (email = "admin@example.com") =>
  ({ userSession: { userId: email } }) as never;

describe("QueueStatusController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getStatus returns queues + workers + generatedAt", async () => {
    const result = await make().getStatus();
    expect(service.getQueueStats).toHaveBeenCalled();
    expect(service.getWorkers).toHaveBeenCalled();
    expect(result).toHaveProperty("queues");
    expect(result).toHaveProperty("workers");
    expect(typeof result.generatedAt).toBe("string");
  });

  it("getStatus scans heartbeats once and shares them with both reads", async () => {
    const heartbeats = [{ instanceId: "pod-a" }];
    service.getAllWorkerHeartbeats.mockResolvedValueOnce(heartbeats);
    await make().getStatus();
    // Exactly one heartbeat scan per status request, passed into both reads.
    expect(service.getAllWorkerHeartbeats).toHaveBeenCalledTimes(1);
    expect(service.getQueueStats).toHaveBeenCalledWith(heartbeats);
    expect(service.getWorkers).toHaveBeenCalledWith(heartbeats);
  });

  it("getFailed parses the limit query and delegates", async () => {
    await make().getFailed("mark.attempt", "40");
    expect(service.getFailedJobs).toHaveBeenCalledWith("mark.attempt", 40);
  });

  it("getFailed defaults limit when query is missing/NaN", async () => {
    await make().getFailed("mark.attempt", undefined);
    expect(service.getFailedJobs).toHaveBeenCalledWith("mark.attempt", 25);
  });

  it("getActive parses limit and delegates", async () => {
    await make().getActive("mark.attempt", "10");
    expect(service.getActiveJobs).toHaveBeenCalledWith("mark.attempt", 10);
  });

  it("getActive defaults limit when query is missing", async () => {
    await make().getActive("mark.attempt", undefined);
    expect(service.getActiveJobs).toHaveBeenCalledWith("mark.attempt", 25);
  });

  it("getRedisHealth delegates", async () => {
    await make().getRedisHealth();
    expect(service.getRedisHealth).toHaveBeenCalled();
  });

  describe("retryJob", () => {
    it("rejects an unknown queue before touching the service", async () => {
      await expect(make().retryJob("bogus", "1", req())).rejects.toThrow(
        NotFoundException,
      );
      expect(service.retryFailedJob).not.toHaveBeenCalled();
    });

    it("rejects a malformed jobId", async () => {
      await expect(
        make().retryJob("mark.attempt", "../etc/passwd", req()),
      ).rejects.toThrow(NotFoundException);
      expect(service.retryFailedJob).not.toHaveBeenCalled();
    });

    it("returns ok when the job was retried", async () => {
      service.retryFailedJob.mockResolvedValue(true);
      const out = await make().retryJob("mark.attempt", "9", req());
      expect(service.retryFailedJob).toHaveBeenCalledWith("mark.attempt", "9");
      expect(out).toEqual({ ok: true });
    });

    it("throws NotFound when the job is not retriable (non-failed/missing)", async () => {
      service.retryFailedJob.mockResolvedValue(false);
      await expect(make().retryJob("mark.attempt", "9", req())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("removeJob", () => {
    it("rejects an unknown queue", async () => {
      await expect(make().removeJob("bogus", "1", req())).rejects.toThrow(
        NotFoundException,
      );
      expect(service.removeFailedJob).not.toHaveBeenCalled();
    });

    it("returns ok when the job was removed", async () => {
      service.removeFailedJob.mockResolvedValue(true);
      const out = await make().removeJob("mark.attempt", "9", req());
      expect(service.removeFailedJob).toHaveBeenCalledWith("mark.attempt", "9");
      expect(out).toEqual({ ok: true });
    });

    it("throws NotFound when the job is not removable", async () => {
      service.removeFailedJob.mockResolvedValue(false);
      await expect(
        make().removeJob("mark.attempt", "9", req()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("access gating", () => {
    // AdminGuard is the single source of truth: it is applied at the class
    // level so every current and future route is admin-gated by default, and no
    // route carries @Roles (which would route through RolesGlobalGuard and
    // couple admin access to an author-role session being present).
    const handlerNames = [
      "getStatus",
      "getRedisHealth",
      "getFailed",
      "getActive",
      "retryJob",
      "removeJob",
    ] as const;

    it("applies AdminGuard at the controller class level", () => {
      const guards = (Reflect.getMetadata(
        "__guards__",
        QueueStatusController,
      ) ?? []) as unknown[];
      expect(guards).toContain(AdminGuard);
    });

    it("declares no @Roles metadata on any route (AdminGuard-only gating)", () => {
      for (const name of handlerNames) {
        const handler = (
          QueueStatusController.prototype as Record<string, unknown>
        )[name];
        const roles = Reflect.getMetadata("roles", handler as object);
        expect(roles).toBeUndefined();
      }
    });
  });
});
