import { GradingRateLimiterService } from "./grading-rate-limiter.service";

describe("GradingRateLimiterService rollout switch", () => {
  const originalParallelGrading = process.env.ENABLE_PARALLEL_GRADING;
  const originalConcurrency = process.env.GRADING_CONCURRENCY;

  afterEach(() => {
    if (originalParallelGrading === undefined) {
      delete process.env.ENABLE_PARALLEL_GRADING;
    } else {
      process.env.ENABLE_PARALLEL_GRADING = originalParallelGrading;
    }

    if (originalConcurrency === undefined) {
      delete process.env.GRADING_CONCURRENCY;
    } else {
      process.env.GRADING_CONCURRENCY = originalConcurrency;
    }
  });

  it("defaults to sequential grading when the switch is unset", () => {
    delete process.env.ENABLE_PARALLEL_GRADING;
    process.env.GRADING_CONCURRENCY = "8";

    const service = new GradingRateLimiterService();

    expect(service.parallelEnabled).toBe(false);
    expect(service.concurrency).toBe(1);
  });

  it("keeps grading sequential when the switch is false", () => {
    process.env.ENABLE_PARALLEL_GRADING = "false";
    process.env.GRADING_CONCURRENCY = "8";

    const service = new GradingRateLimiterService();

    expect(service.parallelEnabled).toBe(false);
    expect(service.concurrency).toBe(1);
  });

  it("uses configured concurrency only when the switch is exactly true", () => {
    process.env.ENABLE_PARALLEL_GRADING = "true";
    process.env.GRADING_CONCURRENCY = "8";

    const service = new GradingRateLimiterService();

    expect(service.parallelEnabled).toBe(true);
    expect(service.concurrency).toBe(8);
  });
});
