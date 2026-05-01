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
}

describe("AttemptAccessCacheService", () => {
  const mockPrisma = {
    question: {
      findMany: jest.fn(),
    },
  } as unknown as PrismaService;

  const logger = {
    child: jest.fn().mockReturnValue({
      warn: jest.fn(),
    }),
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
});
