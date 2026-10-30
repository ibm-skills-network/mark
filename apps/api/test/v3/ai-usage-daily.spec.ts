import { AIUsageType, PrismaClient } from "@prisma/client";
import { UsageTrackerService } from "../../src/api/llm/core/services/usage-tracking.service";

// Contract: every tracked model call lands in AIUsageDaily, so one table sums
// to total input, cached input and output per day and model. Runs against a
// real migrated database, since the counters rely on the upsert being atomic.
const databaseUrl = process.env.DATABASE_URL_TEST;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("AIUsageDaily ledger", () => {
  let prisma: PrismaClient;
  let tracker: UsageTrackerService;
  let assignmentId: number;
  const quiet = { debug: jest.fn(), error: jest.fn() };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    tracker = new UsageTrackerService(
      prisma as never,
      { child: () => quiet } as never,
    );
    const assignment = await prisma.assignment.create({
      data: { name: "ai usage spec", type: "AI_GRADED", published: false },
      select: { id: true },
    });
    assignmentId = assignment.id;
  });

  beforeEach(() => prisma.aIUsageDaily.deleteMany({}));

  afterAll(async () => {
    await prisma.aIUsageDaily.deleteMany({});
    await prisma.assignment.delete({ where: { id: assignmentId } });
    await prisma.$disconnect();
  });

  it("loses nothing when calls for the same row race", async () => {
    await Promise.all(
      Array.from({ length: 25 }, () =>
        tracker.trackUsage(
          assignmentId,
          AIUsageType.ASSIGNMENT_GRADING,
          10,
          2,
          "gpt-6-luna",
          { cachedInputTokens: 4 },
        ),
      ),
    );
    const rows = await prisma.aIUsageDaily.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inputTokens: BigInt(250),
      cachedInputTokens: BigInt(100),
      outputTokens: BigInt(50),
      calls: BigInt(25),
      failedCalls: BigInt(0),
    });
    expect(quiet.error).not.toHaveBeenCalled();
  });

  it("sums per model and type across assignments and chats with none", async () => {
    await tracker.trackUsage(
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      10,
      1,
      "gpt-6-luna",
    );
    await tracker.trackUsage(
      null,
      AIUsageType.CHAT_ASSISTANT,
      20,
      2,
      "gpt-6-luna",
    );
    await tracker.trackUsage(
      assignmentId,
      AIUsageType.ASSIGNMENT_GRADING,
      40,
      4,
      "gpt-4o-mini",
      { failed: true },
    );

    const byModel = await prisma.aIUsageDaily.groupBy({
      by: ["modelKey"],
      _sum: { inputTokens: true, outputTokens: true, failedCalls: true },
      orderBy: { modelKey: "asc" },
    });
    expect(byModel).toEqual([
      {
        modelKey: "gpt-4o-mini",
        _sum: {
          inputTokens: BigInt(40),
          outputTokens: BigInt(4),
          failedCalls: BigInt(1),
        },
      },
      {
        modelKey: "gpt-6-luna",
        _sum: {
          inputTokens: BigInt(30),
          outputTokens: BigInt(3),
          failedCalls: BigInt(0),
        },
      },
    ]);
  });

  it("keeps the spend after the assignment is deleted", async () => {
    const doomed = await prisma.assignment.create({
      data: { name: "doomed", type: "AI_GRADED", published: false },
      select: { id: true },
    });
    await tracker.trackUsage(doomed.id, AIUsageType.TRANSLATION, 5, 5, "m");
    await prisma.aIUsage.deleteMany({ where: { assignmentId: doomed.id } });
    await prisma.assignment.delete({ where: { id: doomed.id } });
    await expect(
      prisma.aIUsageDaily.count({ where: { assignmentId: doomed.id } }),
    ).resolves.toBe(1);
  });
});
