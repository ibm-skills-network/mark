import { JOB_NAMES, JOB_QUEUE_NAMES } from "./job-queue.constants";

const mockAdd = jest.fn().mockResolvedValue(undefined);

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockAdd,
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("./redis.connection", () => ({
  createRedisConnection: jest.fn(() => ({
    quit: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock("./job-payload.crypto", () => ({
  encryptJobPayload: jest.fn((payload: unknown) => payload),
}));

import { JobQueueService } from "./job-queue.service";

describe("JobQueueService priority application", () => {
  let service: JobQueueService;

  beforeEach(() => {
    mockAdd.mockClear();
    service = new JobQueueService();
  });

  it("applies priority 1 to learner grading jobs", async () => {
    await service.enqueue(
      JOB_QUEUE_NAMES.ATTEMPT,
      JOB_NAMES.ATTEMPT_GRADE,
      { attemptId: 1 },
      { jobId: "job-1" },
    );
    expect(mockAdd).toHaveBeenCalledWith(
      JOB_NAMES.ATTEMPT_GRADE,
      { attemptId: 1 },
      expect.objectContaining({ jobId: "job-1", priority: 1 }),
    );
  });

  it("applies priority 10 to author preview jobs", async () => {
    await service.enqueue(
      JOB_QUEUE_NAMES.ATTEMPT,
      JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      {},
      {},
    );
    expect(mockAdd).toHaveBeenCalledWith(
      JOB_NAMES.ATTEMPT_AUTHOR_PREVIEW,
      {},
      expect.objectContaining({ priority: 10 }),
    );
  });

  it("leaves unmapped job names unprioritized", async () => {
    await service.enqueue(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
      {},
      {},
    );
    const options = mockAdd.mock.calls[0][2] as { priority?: number };
    expect(options.priority).toBeUndefined();
  });

  it("lets an explicit caller priority override the map", async () => {
    await service.enqueue(
      JOB_QUEUE_NAMES.ATTEMPT,
      JOB_NAMES.ATTEMPT_GRADE,
      {},
      { priority: 5 },
    );
    expect(mockAdd).toHaveBeenCalledWith(
      JOB_NAMES.ATTEMPT_GRADE,
      {},
      expect.objectContaining({ priority: 5 }),
    );
  });
});
