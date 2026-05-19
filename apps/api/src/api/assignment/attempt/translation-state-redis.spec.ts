import {
  buildInflightKey,
  decrementInflightLanguage,
  isLanguageInFlight,
  seedInflightLanguages,
} from "./translation-state-redis";

const makeRedis = (overrides: Partial<Record<string, jest.Mock>> = {}) => ({
  multi: jest.fn().mockReturnValue({
    hincrby: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  }),
  eval: jest.fn().mockResolvedValue(0),
  hget: jest.fn().mockResolvedValue(null),
  ...overrides,
});

describe("decrementInflightLanguage", () => {
  it("uses a Lua clamp so a retried worker cannot push the counter below 0", async () => {
    const redis = makeRedis();
    await decrementInflightLanguage(redis as never, 42, "es");

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("if v > 0"),
      1,
      buildInflightKey(42),
      "es",
    );
    // Must NOT fall back to a plain HINCRBY that could go negative
    expect(redis).not.toHaveProperty("hincrby");
  });

  it("is idempotent when called twice against a once-seeded counter (retry simulation)", async () => {
    // Simulate Redis state: counter starts at 1, first decrement brings it to 0,
    // second decrement (retry) must not produce -1.
    let storedValue = 1;
    const redis = {
      eval: jest.fn().mockImplementation(async () => {
        if (storedValue > 0) storedValue -= 1;
        return 0;
      }),
    };

    await decrementInflightLanguage(redis as never, 1, "fr");
    expect(storedValue).toBe(0);

    await decrementInflightLanguage(redis as never, 1, "fr");
    expect(storedValue).toBe(0); // must not go negative
  });
});

describe("isLanguageInFlight", () => {
  it("returns false when the hash field is absent", async () => {
    const redis = makeRedis({ hget: jest.fn().mockResolvedValue(null) });
    await expect(isLanguageInFlight(redis as never, 1, "de")).resolves.toBe(
      false,
    );
  });

  it("returns true when the counter is > 0", async () => {
    const redis = makeRedis({ hget: jest.fn().mockResolvedValue("2") });
    await expect(isLanguageInFlight(redis as never, 1, "de")).resolves.toBe(
      true,
    );
  });

  it("returns false when the counter is 0", async () => {
    const redis = makeRedis({ hget: jest.fn().mockResolvedValue("0") });
    await expect(isLanguageInFlight(redis as never, 1, "de")).resolves.toBe(
      false,
    );
  });

  it("fails open (returns false) when Redis throws, rather than propagating to the learner request", async () => {
    const redis = makeRedis({
      hget: jest.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    // Must not throw — a Redis blip should not produce a 500 for the learner
    await expect(isLanguageInFlight(redis as never, 1, "ja")).resolves.toBe(
      false,
    );
  });
});

describe("seedInflightLanguages", () => {
  it("is a no-op when perLanguageCount is 0", async () => {
    const pipeline = {
      hincrby: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    const redis = { multi: jest.fn().mockReturnValue(pipeline) };
    await seedInflightLanguages(redis as never, 1, ["en", "fr"], 0);
    expect(pipeline.hincrby).not.toHaveBeenCalled();
  });
});
