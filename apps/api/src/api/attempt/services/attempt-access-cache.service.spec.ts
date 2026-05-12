import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { PrismaService } from "../../../database/prisma.service";
import { createRedisConnection } from "../../../job-queue/redis.connection";

jest.mock("../../../job-queue/redis.connection", () => ({
  createRedisConnection: jest.fn(),
}));

class FakeRedis {
  public readonly values = new Map<string, string>();
  public readonly ttls = new Map<string, number>();
  public readonly quit = jest.fn(async () => undefined);
  public readonly on = jest.fn();
  public scanShouldFail = false;

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(
    key: string,
    value: string,
    mode?: "EX",
    ttlSeconds?: number,
  ): Promise<string> {
    this.values.set(key, value);
    if (mode === "EX" && ttlSeconds !== undefined) {
      this.ttls.set(key, ttlSeconds);
    }
    return "OK";
  }

  async scan(
    cursor: string,
    matchKeyword: "MATCH",
    pattern: string,
    countKeyword: "COUNT",
    count: number,
  ): Promise<[string, string[]]> {
    void matchKeyword;
    void countKeyword;
    if (this.scanShouldFail) {
      throw new Error("redis scan boom");
    }
    const allKeys = [...this.values.keys()];
    const regex = new RegExp(
      "^" +
        pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
        "$",
    );
    const matched = allKeys.filter((k) => regex.test(k));
    const start = parseInt(cursor, 10);
    const slice = matched.slice(start, start + count);
    const nextCursor =
      start + count >= matched.length ? "0" : String(start + count);
    return [nextCursor, slice];
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.values.delete(key)) {
        removed += 1;
      }
      this.ttls.delete(key);
    }
    return removed;
  }
}

describe("AttemptAccessCacheService", () => {
  const mockPrisma = {
    question: {
      findMany: jest.fn(),
    },
    assignmentVersion: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService;

  const childLogger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const logger = {
    child: jest.fn().mockReturnValue(childLogger),
  };

  let fakeRedis: FakeRedis;
  let service: AttemptAccessCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    fakeRedis = new FakeRedis();
    (createRedisConnection as jest.Mock).mockReturnValue(fakeRedis);
    service = new AttemptAccessCacheService(mockPrisma, logger as never);
  });

  it("caches versioned question payloads in Redis and serves subsequent hits without hitting prisma", async () => {
    const versionedQuestions = [
      {
        id: 7,
        questionId: 70,
        question: "Versioned question",
        type: "TEXT",
        totalPoints: 5,
        maxWords: null,
        maxCharacters: null,
        choices: [],
        scoring: { type: "CRITERIA_BASED", rubrics: [] },
        answer: true,
        gradingContextQuestionIds: [],
        responseType: "TEXT",
        randomizedChoices: false,
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      },
    ];

    const first = await service.getQuestionDtosForAttemptAccess({
      assignmentId: 10,
      assignmentUpdatedAt: new Date("2026-04-26T00:00:00.000Z"),
      assignmentVersionId: 77,
      questionVersions: versionedQuestions as never,
    });

    const second = await service.getQuestionDtosForAttemptAccess({
      assignmentId: 10,
      assignmentUpdatedAt: new Date("2026-04-26T00:00:00.000Z"),
      assignmentVersionId: 77,
      questionVersions: versionedQuestions as never,
    });

    expect(first).toEqual(second);
    expect(mockPrisma.question.findMany).not.toHaveBeenCalled();
    expect(fakeRedis.values.get("mark:attempt-access:version:77")).toBeTruthy();
    expect(fakeRedis.ttls.get("mark:attempt-access:version:77")).toBe(600);
  });

  it("backfills assignment-scoped questions on a cache miss and avoids a second prisma query on hit", async () => {
    mockPrisma.question.findMany = jest.fn().mockResolvedValue([
      {
        id: 101,
        question: "Database question",
        type: "TEXT",
        assignmentId: 44,
        totalPoints: 10,
        maxWords: null,
        maxCharacters: null,
        choices: [],
        scoring: { type: "CRITERIA_BASED", rubrics: [] },
        answer: false,
        gradingContextQuestionIds: [],
        responseType: "TEXT",
        isDeleted: false,
        randomizedChoices: false,
        videoPresentationConfig: null,
        liveRecordingConfig: null,
      },
    ]);

    const params = {
      assignmentId: 44,
      assignmentUpdatedAt: new Date("2026-04-26T01:00:00.000Z"),
      assignmentVersionId: null,
    };

    const first = await service.getQuestionDtosForAttemptAccess(params);
    const second = await service.getQuestionDtosForAttemptAccess(params);

    expect(first).toEqual(second);
    expect(mockPrisma.question.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.question.findMany).toHaveBeenCalledWith({
      where: {
        assignmentId: 44,
        isDeleted: false,
      },
    });
    expect(
      fakeRedis.values.get("mark:attempt-access:assignment:44:1777165200000"),
    ).toBeTruthy();
  });

  describe("invalidateForAssignment", () => {
    it("scans and deletes only assignment-scoped keys for the target id", async () => {
      fakeRedis.values.set("mark:attempt-access:assignment:44:1000", "[]");
      fakeRedis.values.set("mark:attempt-access:assignment:44:2000", "[]");
      fakeRedis.values.set("mark:attempt-access:assignment:99:3000", "[]");
      (mockPrisma.assignmentVersion.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await service.invalidateForAssignment(44);

      expect(
        fakeRedis.values.get("mark:attempt-access:assignment:44:1000"),
      ).toBeUndefined();
      expect(
        fakeRedis.values.get("mark:attempt-access:assignment:44:2000"),
      ).toBeUndefined();
      expect(
        fakeRedis.values.get("mark:attempt-access:assignment:99:3000"),
      ).toBe("[]");
      expect(mockPrisma.assignmentVersion.findMany).toHaveBeenCalledWith({
        where: { assignmentId: 44 },
        select: { id: true },
      });
    });

    it("deletes version-scoped keys for every version of the assignment", async () => {
      fakeRedis.values.set("mark:attempt-access:version:101", "[]");
      fakeRedis.values.set("mark:attempt-access:version:102", "[]");
      fakeRedis.values.set("mark:attempt-access:version:999", "[]");
      (mockPrisma.assignmentVersion.findMany as jest.Mock).mockResolvedValue([
        { id: 101 },
        { id: 102 },
      ]);

      await service.invalidateForAssignment(44);

      expect(
        fakeRedis.values.get("mark:attempt-access:version:101"),
      ).toBeUndefined();
      expect(
        fakeRedis.values.get("mark:attempt-access:version:102"),
      ).toBeUndefined();
      expect(fakeRedis.values.get("mark:attempt-access:version:999")).toBe(
        "[]",
      );
    });

    it("swallows redis failures and logs a warning", async () => {
      fakeRedis.scanShouldFail = true;
      (mockPrisma.assignmentVersion.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      await expect(
        service.invalidateForAssignment(44),
      ).resolves.toBeUndefined();
      expect(childLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("attempt-access-cache.invalidate.failed"),
      );
    });
  });
});
