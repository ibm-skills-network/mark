import { ConcurrencyLimiter } from "./concurrency-limiter";

describe("ConcurrencyLimiter", () => {
  it("respects max concurrency", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let current = 0;
    let max = 0;

    const tasks = Array.from({ length: 6 }, (_, index) => async () => {
      current += 1;
      max = Math.max(max, current);
      await new Promise((resolve) => setTimeout(resolve, 10));
      current -= 1;
      return index;
    });

    const results = await limiter.run(tasks);

    expect(results).toHaveLength(6);
    expect(max).toBeLessThanOrEqual(2);
  });
});
