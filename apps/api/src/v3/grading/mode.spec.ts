import { QuestionType } from "@prisma/client";
import { GradingModeResolver, type ModeConfigRow } from "./mode";

function logger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function row(partial: Partial<ModeConfigRow>): ModeConfigRow {
  return {
    id: 1,
    questionType: QuestionType.TEXT,
    assignmentId: null,
    mode: "off",
    effort: null,
    ...partial,
  };
}

describe("GradingModeResolver", () => {
  let now = 0;
  let rows: ModeConfigRow[] = [];
  let shadowAllowed = false;
  let log = logger();
  let readRows: jest.Mock;
  let resolver: GradingModeResolver;

  beforeEach(() => {
    now = 1_000_000;
    rows = [];
    shadowAllowed = false;
    log = logger();
    readRows = jest.fn(
      (questionType: QuestionType, assignmentId: number | null) =>
        Promise.resolve(
          rows.filter(
            (item) =>
              item.questionType === questionType &&
              (item.assignmentId === null ||
                item.assignmentId === assignmentId),
          ),
        ),
    );
    resolver = new GradingModeResolver({
      readRows,
      logger: log,
      now: () => now,
      shadowAllowed: () => shadowAllowed,
    });
  });

  it("is off with the type's default effort when no row exists", async () => {
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual({
      mode: "off",
      effort: "low",
      source: "default",
    });
    await expect(resolver.resolve(QuestionType.UPLOAD, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off", effort: "medium" }),
    );
  });

  it("uses the global row when the assignment has none", async () => {
    rows = [row({ id: 9, mode: "live", effort: "high" })];
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual({
      mode: "live",
      effort: "high",
      source: "global",
      configId: 9,
    });
  });

  it("lets an assignment row override the global row, both ways", async () => {
    rows = [
      row({ id: 1, mode: "live" }),
      row({ id: 2, assignmentId: 5, mode: "off" }),
      row({
        id: 3,
        questionType: QuestionType.URL,
        assignmentId: 6,
        mode: "live",
      }),
    ];
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({
        mode: "off",
        source: "assignment",
        configId: 2,
      }),
    );
    await expect(resolver.resolve(QuestionType.TEXT, 7)).resolves.toEqual(
      expect.objectContaining({ mode: "live", source: "global" }),
    );
    await expect(resolver.resolve(QuestionType.URL, 6)).resolves.toEqual(
      expect.objectContaining({ mode: "live", source: "assignment" }),
    );
  });

  it("refuses shadow unless allowed, and logs it", async () => {
    rows = [row({ mode: "shadow" })];
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off" }),
    );
    expect(log.info).toHaveBeenCalledWith(
      "grading.mode.shadow_refused",
      expect.objectContaining({ questionType: QuestionType.TEXT }),
    );

    shadowAllowed = true;
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "shadow" }),
    );
  });

  it("reads shadow as off when the env flag is not exactly 'true'", async () => {
    const previous = process.env.GRADING_SHADOW_ALLOWED;
    process.env.GRADING_SHADOW_ALLOWED = "TRUE";
    try {
      const envResolver = new GradingModeResolver({
        readRows: () => Promise.resolve([row({ mode: "shadow" })]),
        logger: logger(),
      });
      await expect(envResolver.resolve(QuestionType.TEXT, 1)).resolves.toEqual(
        expect.objectContaining({ mode: "off" }),
      );
    } finally {
      process.env.GRADING_SHADOW_ALLOWED = previous;
    }
  });

  it("caches for 30 seconds", async () => {
    rows = [row({ mode: "live" })];
    await resolver.resolve(QuestionType.TEXT, 5);
    rows = [row({ mode: "off" })];
    now += 29_000;
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "live" }),
    );
    expect(readRows).toHaveBeenCalledTimes(1);
    now += 2000;
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off" }),
    );
    expect(readRows).toHaveBeenCalledTimes(2);
  });

  it("drops the cache on clear", async () => {
    rows = [row({ mode: "live" })];
    await resolver.resolve(QuestionType.TEXT, 5);
    rows = [];
    resolver.clear();
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off" }),
    );
  });

  it("reads as off with a warning when the config can't be read, and doesn't cache that", async () => {
    readRows.mockRejectedValueOnce(new Error("connection refused"));
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off", source: "error" }),
    );
    expect(log.warn).toHaveBeenCalledWith(
      "grading.mode.read_failed",
      expect.objectContaining({ assignmentId: 5 }),
    );
    rows = [row({ mode: "live" })];
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "live" }),
    );
  });

  it("treats unknown stored values as off and default effort", async () => {
    rows = [row({ mode: "LIVE!", effort: "max" })];
    await expect(resolver.resolve(QuestionType.TEXT, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off", effort: "low" }),
    );
  });

  it("never turns on for types v3 does not grade", async () => {
    rows = [row({ questionType: QuestionType.TRUE_FALSE, mode: "live" })];
    await expect(resolver.resolve(QuestionType.TRUE_FALSE, 5)).resolves.toEqual(
      expect.objectContaining({ mode: "off" }),
    );
    expect(readRows).not.toHaveBeenCalled();
  });
});
