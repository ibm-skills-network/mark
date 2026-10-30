import {
  applyEffortBoost,
  type BoostConfig,
  BoostConfigResolver,
  DEFAULT_BOOST_CONFIG,
  effortBoostPoints,
} from "./boost";

const on: BoostConfig = { enabled: true, pointsPerStep: 4, maxBoost: 3 };

describe("effortBoostPoints", () => {
  it.each([
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 1],
    [7, 1],
    [8, 2],
    [11, 2],
    [12, 3],
    [40, 3],
  ])("a question out of %d earns up to %d", (maxPoints, expected) => {
    expect(effortBoostPoints(maxPoints, on)).toBe(expected);
  });

  it("is 0 when switched off", () => {
    expect(effortBoostPoints(12, { ...on, enabled: false })).toBe(0);
  });
});

describe("applyEffortBoost", () => {
  it("adds the boost to a solid attempt", () => {
    expect(applyEffortBoost(2, 4, true, on)).toEqual({ points: 3, boost: 1 });
  });

  it("gives a solid attempt that scored 0 the boost too", () => {
    expect(applyEffortBoost(0, 8, true, on)).toEqual({ points: 2, boost: 2 });
  });

  it("adds nothing when the attempt was not solid", () => {
    expect(applyEffortBoost(2, 4, false, on)).toEqual({ points: 2, boost: 0 });
  });

  it("never goes past the question's points", () => {
    expect(applyEffortBoost(11, 12, true, on)).toEqual({
      points: 12,
      boost: 1,
    });
    expect(applyEffortBoost(4, 4, true, on)).toEqual({ points: 4, boost: 0 });
  });

  it("keeps fractional scores to two decimals", () => {
    expect(applyEffortBoost(1.33, 4, true, on)).toEqual({
      points: 2.33,
      boost: 1,
    });
  });
});

describe("BoostConfigResolver", () => {
  const logger = () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });

  it("reads the stored row and caches it", async () => {
    const read = jest.fn().mockResolvedValue(on);
    let now = 0;
    const resolver = new BoostConfigResolver({
      read,
      logger: logger(),
      now: () => now,
      ttlMs: 1000,
    });
    await expect(resolver.get()).resolves.toEqual(on);
    now = 999;
    await resolver.get();
    expect(read).toHaveBeenCalledTimes(1);
    now = 1000;
    await resolver.get();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("is off when no row exists", async () => {
    const resolver = new BoostConfigResolver({
      read: jest.fn().mockResolvedValue(null),
      logger: logger(),
    });
    await expect(resolver.get()).resolves.toEqual(DEFAULT_BOOST_CONFIG);
    expect(DEFAULT_BOOST_CONFIG.enabled).toBe(false);
  });

  it("is off, uncached and logged when the read fails", async () => {
    const log = logger();
    const read = jest
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(on);
    const resolver = new BoostConfigResolver({ read, logger: log });
    await expect(resolver.get()).resolves.toEqual(DEFAULT_BOOST_CONFIG);
    expect(log.warn).toHaveBeenCalledWith(
      "grading.boost.read_failed",
      expect.objectContaining({ error: "db down" }),
    );
    await expect(resolver.get()).resolves.toEqual(on);
  });

  it("is off when a stored value is out of bounds", async () => {
    const resolver = new BoostConfigResolver({
      read: jest.fn().mockResolvedValue({ ...on, pointsPerStep: 0 }),
      logger: logger(),
    });
    await expect(resolver.get()).resolves.toEqual(DEFAULT_BOOST_CONFIG);
  });

  it("reads again after clear()", async () => {
    const read = jest.fn().mockResolvedValue(on);
    const resolver = new BoostConfigResolver({ read, logger: logger() });
    await resolver.get();
    resolver.clear();
    await resolver.get();
    expect(read).toHaveBeenCalledTimes(2);
  });
});
