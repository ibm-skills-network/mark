import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Test, TestingModule } from "@nestjs/testing";
import { GradingCacheService } from "./grading-cache.service";
import { PrismaService } from "src/database/prisma.service";
import { ICachedGradingResult } from "../interfaces/grading-cache.interface";
import { createRedisConnection } from "src/job-queue/redis.connection";

jest.mock("src/job-queue/redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

const makeResult = (
  overrides: Partial<ICachedGradingResult> = {},
): ICachedGradingResult => ({
  cacheKey: "key-abc",
  questionId: 1,
  rubricHash: "rub-hash",
  answerHash: "ans-hash",
  totalScore: 8,
  maxScore: 10,
  criteria: [],
  overallFeedback: "Good work",
  cachedAt: new Date(),
  hitCount: 0,
  ...overrides,
});

class FakeRedis {
  public readonly data = new Map<string, string>();
  public readonly ttls = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    _exMode?: "EX",
    ttl?: number,
  ): Promise<"OK"> {
    this.data.set(key, value);
    if (ttl !== undefined) this.ttls.set(key, ttl);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.data.delete(key)) count++;
    }
    return count;
  }

  async exists(key: string): Promise<number> {
    return this.data.has(key) ? 1 : 0;
  }

  async scan(
    _cursor: string,
    _match: "MATCH",
    pattern: string,
    _count: "COUNT",
    _limit: number,
  ): Promise<[string, string[]]> {
    const prefix = pattern.replace("*", "");
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix));
    return ["0", keys];
  }

  on = jest.fn();
  quit = jest.fn(async () => undefined);
}

describe("GradingCacheService — Redis L1 cache (Change 8)", () => {
  let service: GradingCacheService;
  let fakeRedis: FakeRedis;

  const mockPrisma = {
    gradingCache: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined),
      count: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockLogger = {
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    fakeRedis = new FakeRedis();
    (createRedisConnection as jest.Mock).mockReturnValue(fakeRedis);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingCacheService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<GradingCacheService>(GradingCacheService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  // ─── getCachedGrading ──────────────────────────────────────────────────────

  describe("getCachedGrading", () => {
    it("returns the cached result from Redis on L1 hit without hitting PostgreSQL", async () => {
      const result = makeResult({ hitCount: 5 });
      fakeRedis.data.set(
        `mark:grading-cache:${result.cacheKey}`,
        JSON.stringify(result),
      );

      const fetched = await service.getCachedGrading(result.cacheKey);

      expect(fetched).not.toBeNull();
      expect(fetched!.cacheKey).toBe(result.cacheKey);
      expect(fetched!.hitCount).toBe(6); // incremented by 1
      expect(mockPrisma.gradingCache.findUnique).not.toHaveBeenCalled();
    });

    it("queries PostgreSQL on L1 miss and backfills Redis", async () => {
      const now = new Date();
      const dbRecord = {
        cacheKey: "miss-key",
        questionId: 2,
        rubricHash: "rh",
        answerHash: "ah",
        totalScore: 7,
        maxScore: 10,
        criteria: [],
        overallFeedback: "OK",
        cachedAt: now,
        hitCount: 3,
        metadata: null,
      };

      mockPrisma.gradingCache.findUnique.mockResolvedValue(dbRecord);
      mockPrisma.gradingCache.update.mockResolvedValue(undefined);

      expect(fakeRedis.data.has("mark:grading-cache:miss-key")).toBe(false);

      const fetched = await service.getCachedGrading("miss-key");

      expect(fetched).not.toBeNull();
      expect(fetched!.hitCount).toBe(4);
      // Redis must now be populated (backfill)
      expect(fakeRedis.data.has("mark:grading-cache:miss-key")).toBe(true);
    });

    it("returns null on complete cache miss (no Redis, no PostgreSQL entry)", async () => {
      mockPrisma.gradingCache.findUnique.mockResolvedValue(null);

      const fetched = await service.getCachedGrading("no-such-key");

      expect(fetched).toBeNull();
    });

    it("returns null and does not throw when Redis.get throws", async () => {
      jest.spyOn(fakeRedis, "get").mockRejectedValue(new Error("Redis down"));
      mockPrisma.gradingCache.findUnique.mockResolvedValue(null);

      const fetched = await service.getCachedGrading("some-key");
      expect(fetched).toBeNull();
    });
  });

  // ─── cacheGrading ─────────────────────────────────────────────────────────

  describe("cacheGrading", () => {
    it("writes to PostgreSQL and then populates Redis", async () => {
      const result = makeResult({ cacheKey: "new-key", hitCount: 0 });
      mockPrisma.gradingCache.upsert.mockResolvedValue(undefined);

      await service.cacheGrading(result);

      expect(mockPrisma.gradingCache.upsert).toHaveBeenCalledTimes(1);
      expect(fakeRedis.data.has(`mark:grading-cache:${result.cacheKey}`)).toBe(
        true,
      );
      const stored = JSON.parse(
        fakeRedis.data.get(`mark:grading-cache:${result.cacheKey}`)!,
      ) as ICachedGradingResult;
      expect(stored.cacheKey).toBe("new-key");
    });

    it("sets a 7-day TTL on the Redis entry", async () => {
      const result = makeResult({ cacheKey: "ttl-key" });
      mockPrisma.gradingCache.upsert.mockResolvedValue(undefined);

      await service.cacheGrading(result);

      const ttl = fakeRedis.ttls.get(`mark:grading-cache:ttl-key`);
      expect(ttl).toBe(7 * 24 * 60 * 60);
    });

    it("does not throw when Redis.set fails after PostgreSQL succeeds", async () => {
      jest
        .spyOn(fakeRedis, "set")
        .mockRejectedValue(new Error("Redis write failed"));
      mockPrisma.gradingCache.upsert.mockResolvedValue(undefined);

      await expect(service.cacheGrading(makeResult())).resolves.not.toThrow();
    });
  });

  // ─── isCached ─────────────────────────────────────────────────────────────

  describe("isCached", () => {
    it("returns true when the key exists in Redis without querying PostgreSQL", async () => {
      fakeRedis.data.set("mark:grading-cache:exists-key", "{}");

      const result = await service.isCached("exists-key");

      expect(result).toBe(true);
      expect(mockPrisma.gradingCache.count).not.toHaveBeenCalled();
    });

    it("falls through to PostgreSQL when Redis does not have the key", async () => {
      mockPrisma.gradingCache.count.mockResolvedValue(1);

      const result = await service.isCached("pg-only-key");

      expect(result).toBe(true);
      expect(mockPrisma.gradingCache.count).toHaveBeenCalledTimes(1);
    });

    it("returns false when neither layer has the key", async () => {
      mockPrisma.gradingCache.count.mockResolvedValue(0);

      const result = await service.isCached("ghost-key");
      expect(result).toBe(false);
    });
  });

  // ─── invalidateQuestionCache ───────────────────────────────────────────────

  describe("invalidateQuestionCache", () => {
    it("deletes matching Redis keys and all PostgreSQL entries for the question", async () => {
      // Populate Redis with two keys for the same question
      const r1 = makeResult({ cacheKey: "k1", questionId: 99 });
      const r2 = makeResult({ cacheKey: "k2", questionId: 99 });
      fakeRedis.data.set(`mark:grading-cache:k1`, JSON.stringify(r1));
      fakeRedis.data.set(`mark:grading-cache:k2`, JSON.stringify(r2));

      mockPrisma.gradingCache.deleteMany.mockResolvedValue({ count: 2 });

      await service.invalidateQuestionCache(99);

      // Allow the fire-and-forget Redis invalidation to settle
      await new Promise((r) => setImmediate(r));

      expect(mockPrisma.gradingCache.deleteMany).toHaveBeenCalledWith({
        where: { questionId: 99 },
      });
      // Both Redis keys should be gone
      expect(fakeRedis.data.size).toBe(0);
    });
  });

  // ─── Graceful Redis fallback ───────────────────────────────────────────────

  describe("Redis unavailable fallback", () => {
    it("operates in PostgreSQL-only mode when createRedisConnection throws", async () => {
      (createRedisConnection as jest.Mock).mockImplementation(() => {
        throw new Error("Cannot connect to Redis");
      });

      // Rebuild service without Redis
      const module = await Test.createTestingModule({
        providers: [
          GradingCacheService,
          { provide: PrismaService, useValue: mockPrisma },
          { provide: WINSTON_MODULE_PROVIDER, useValue: mockLogger },
        ],
      }).compile();

      const fallbackService =
        module.get<GradingCacheService>(GradingCacheService);

      const dbRecord = {
        cacheKey: "fallback-key",
        questionId: 3,
        rubricHash: "rh",
        answerHash: "ah",
        totalScore: 5,
        maxScore: 10,
        criteria: [],
        overallFeedback: "OK",
        cachedAt: new Date(),
        hitCount: 0,
        metadata: null,
      };
      mockPrisma.gradingCache.findUnique.mockResolvedValue(dbRecord);
      mockPrisma.gradingCache.update.mockResolvedValue(undefined);

      const result = await fallbackService.getCachedGrading("fallback-key");
      expect(result).not.toBeNull();
      expect(result!.cacheKey).toBe("fallback-key");

      await fallbackService.onModuleDestroy();
    });
  });
});
