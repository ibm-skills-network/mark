import { createRateLimiter } from "../rate-limit";

describe("createRateLimiter", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows a caller up to the limit and then blocks", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 3,
      maxTrackedKeys: 10,
    });

    expect(limiter.isRateLimited("caller")).toBe(false);
    expect(limiter.isRateLimited("caller")).toBe(false);
    expect(limiter.isRateLimited("caller")).toBe(false);
    expect(limiter.isRateLimited("caller")).toBe(true);
  });

  it("keeps callers in separate buckets", () => {
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      maxTrackedKeys: 10,
    });

    expect(limiter.isRateLimited("first")).toBe(false);
    expect(limiter.isRateLimited("first")).toBe(true);
    expect(limiter.isRateLimited("second")).toBe(false);
  });

  it("lets a caller through again once the window has passed", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const limiter = createRateLimiter({
      windowMs: 60_000,
      maxRequests: 1,
      maxTrackedKeys: 10,
    });

    expect(limiter.isRateLimited("caller")).toBe(false);
    expect(limiter.isRateLimited("caller")).toBe(true);

    jest.setSystemTime(new Date("2026-01-01T00:01:01Z"));
    expect(limiter.isRateLimited("caller")).toBe(false);
  });

  it("never tracks more callers than it is allowed to", () => {
    const maxTrackedKeys = 50;
    const limiter = createRateLimiter({
      windowMs: 600_000,
      maxRequests: 20,
      maxTrackedKeys,
    });

    for (let caller = 0; caller < maxTrackedKeys * 10; caller++) {
      limiter.isRateLimited(`caller-${caller}`);
      expect(limiter.size).toBeLessThanOrEqual(maxTrackedKeys);
    }

    expect(limiter.size).toBe(maxTrackedKeys);
  });

  it("drops the least recently seen caller first when it runs out of room", () => {
    const limiter = createRateLimiter({
      windowMs: 600_000,
      maxRequests: 2,
      maxTrackedKeys: 2,
    });

    limiter.isRateLimited("old");
    limiter.isRateLimited("kept");
    // "old" is refreshed, so "kept" becomes the least recently seen caller.
    limiter.isRateLimited("old");
    expect(limiter.isRateLimited("old")).toBe(true);

    limiter.isRateLimited("new");

    // "old" survived the eviction and is still over its limit.
    expect(limiter.isRateLimited("old")).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it("does not evict a caller that is actively flooding", () => {
    const limiter = createRateLimiter({
      windowMs: 600_000,
      maxRequests: 1,
      maxTrackedKeys: 2,
    });

    expect(limiter.isRateLimited("flooder")).toBe(false);
    for (let attempt = 0; attempt < 20; attempt++) {
      limiter.isRateLimited(`bystander-${attempt}`);
      expect(limiter.isRateLimited("flooder")).toBe(true);
    }
  });
});
