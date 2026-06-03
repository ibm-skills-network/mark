import type { Logger as WinstonLogger } from "winston";
import {
  QueueDepthSampler,
  type QueueDepthCounts,
} from "./queue-depth-sampler";

const zero: QueueDepthCounts = {
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
  paused: 0,
};

const fakeLogger = () =>
  ({ info: jest.fn(), warn: jest.fn() }) as unknown as WinstonLogger & {
    info: jest.Mock;
    warn: jest.Mock;
  };

describe("QueueDepthSampler", () => {
  it("emits one jobs.queue.depth event per queue with the read counts", async () => {
    const logger = fakeLogger();
    const counts: QueueDepthCounts = {
      ...zero,
      waiting: 3,
      active: 1,
      failed: 2,
    };
    const sampler = new QueueDepthSampler(
      ["mark.attempt", "mark.assignment.v2"],
      async () => counts,
      logger,
      15000,
    );

    await sampler.sampleOnce();

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith("jobs.queue.depth", {
      queue: "mark.attempt",
      ...counts,
    });
    expect(logger.info).toHaveBeenCalledWith("jobs.queue.depth", {
      queue: "mark.assignment.v2",
      ...counts,
    });
  });

  it("logs a warning and keeps going when one queue's read fails", async () => {
    const logger = fakeLogger();
    const sampler = new QueueDepthSampler(
      ["bad", "good"],
      async (queue) => {
        if (queue === "bad") throw new Error("redis down");
        return zero;
      },
      logger,
      15000,
    );

    await sampler.sampleOnce();

    expect(logger.warn).toHaveBeenCalledWith(
      "jobs.queue.depth.sample.failed",
      expect.objectContaining({ queue: "bad", error: "redis down" }),
    );
    expect(logger.info).toHaveBeenCalledWith("jobs.queue.depth", {
      queue: "good",
      ...zero,
    });
  });

  it("never rejects even when every queue's read fails", async () => {
    const logger = fakeLogger();
    const sampler = new QueueDepthSampler(
      ["a", "b"],
      async () => {
        throw new Error("redis down");
      },
      logger,
      15000,
    );

    await expect(sampler.sampleOnce()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
