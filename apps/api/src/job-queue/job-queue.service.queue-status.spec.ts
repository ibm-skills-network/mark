const getJobCounts = jest.fn();
const getFailed = jest.fn();

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation((name: string) => ({
    name,
    getJobCounts,
    getFailed,
    close: jest.fn(),
  })),
}));
jest.mock("./redis.connection", () => ({
  createRedisConnection: () => ({ quit: jest.fn() }),
}));

import { JobQueueService } from "./job-queue.service";

describe("JobQueueService read methods", () => {
  let service: JobQueueService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new JobQueueService();
  });

  it("folds prioritized into waiting and defaults the rest to 0", async () => {
    // Prioritized jobs live in a separate ZSET; they are queued-not-started
    // just like `waiting`, so getQueueCounts must request and add them in.
    getJobCounts.mockResolvedValue({
      waiting: 3,
      prioritized: 4,
      active: 1,
      failed: 2,
    });
    const counts = await service.getQueueCounts("mark.attempt");
    expect(getJobCounts).toHaveBeenCalledWith(
      "waiting",
      "prioritized",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
    );
    expect(counts).toEqual({
      waiting: 7,
      active: 1,
      delayed: 0,
      failed: 2,
      completed: 0,
      paused: 0,
    });
  });

  it("getFailedJobs delegates to queue.getFailed(0, limit-1)", async () => {
    const jobs = [{ id: "1" }];
    getFailed.mockResolvedValue(jobs);
    const result = await service.getFailedJobs("mark.attempt", 25);
    expect(getFailed).toHaveBeenCalledWith(0, 24);
    expect(result).toBe(jobs);
  });
});
