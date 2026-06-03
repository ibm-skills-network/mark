import { QueueStatusController } from "./queue-status.controller";

const service = {
  getQueueStats: jest.fn().mockResolvedValue([]),
  getWorkers: jest.fn().mockResolvedValue([]),
  getFailedJobs: jest.fn().mockResolvedValue([]),
};

const make = () => new QueueStatusController(service as never);

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

  it("getFailed parses the limit query and delegates", async () => {
    await make().getFailed("mark.attempt", "40");
    expect(service.getFailedJobs).toHaveBeenCalledWith("mark.attempt", 40);
  });

  it("getFailed defaults limit when query is missing/NaN", async () => {
    await make().getFailed("mark.attempt", undefined);
    expect(service.getFailedJobs).toHaveBeenCalledWith("mark.attempt", 25);
  });
});
