// The db-retention CronJob deletes rows by age, so its windows and statement
// shapes are pinned here: every sweep must stay bounded, use the indexed age
// column, and never drop below what the product still reads.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const retention = require("../../../../scripts/db-retention.js") as {
  parseArgs: (argv: string[]) => Args;
  cutoffFor: (days: number, now: Date) => Date;
  buildSteps: (args: Args, now: Date, sql: SqlTag) => Step[];
  runSteps: (
    prisma: FakePrisma,
    steps: Step[],
    args: Args,
    deadline: number,
  ) => Promise<{ exhausted: boolean; skipped: string[] }>;
  isUndefinedTable: (error: unknown) => boolean;
  DEFAULTS: Args;
  MIN_DAYS: Record<string, number>;
};

type Args = {
  dryRun: boolean;
  cacheDays: number;
  auditDays: number;
  cookieDays: number;
  ltiSyncDays: number;
  operationDays: number;
  batchSize: number;
  maxSeconds: number;
  pauseMs: number;
};

type Statement = { text: string; values: unknown[] };
type SqlTag = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Statement;
type Step = {
  name: string;
  optionalTable?: boolean;
  cutoff: Date;
  count: (cutoff: Date) => Statement;
  apply: (cutoff: Date, limit: number) => Statement;
};

type FakeTx = {
  $executeRawUnsafe: jest.Mock;
  $executeRaw: jest.Mock;
  $queryRaw: jest.Mock;
};
type FakePrisma = {
  $transaction: (run: (tx: FakeTx) => Promise<unknown>) => Promise<unknown>;
};

// Stand-in for Prisma.sql: keeps the raw text and the bound values apart so
// the tests can assert on both.
const sql: SqlTag = (strings, ...values) => ({
  text: strings.join("?"),
  values,
});

const GRADE_REUSE_LOOKBACK_DAYS = 7;

describe("db-retention arguments", () => {
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new Error(`exit ${code}`);
    }) as never);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("defaults to a dry run with the agreed windows", () => {
    expect(retention.parseArgs(["node", "db-retention.js"])).toEqual({
      dryRun: true,
      cacheDays: 30,
      auditDays: 60,
      cookieDays: 7,
      ltiSyncDays: 365,
      operationDays: 30,
      batchSize: 5000,
      maxSeconds: 1500,
      pauseMs: 200,
    });
  });

  it("accepts --execute and numeric overrides", () => {
    const args = retention.parseArgs([
      "node",
      "db-retention.js",
      "--execute",
      "--cache-days=45",
      "--audit-days=90",
      "--batch-size=100",
      "--max-seconds=0",
      "--operation-days=14",
    ]);
    expect(args.dryRun).toBe(false);
    expect(args.cacheDays).toBe(45);
    expect(args.auditDays).toBe(90);
    expect(args.batchSize).toBe(100);
    expect(args.maxSeconds).toBe(0);
    expect(args.operationDays).toBe(14);
  });

  it("refuses an audit window shorter than the grade-reuse lookback", () => {
    expect(retention.MIN_DAYS.auditDays).toBeGreaterThanOrEqual(
      GRADE_REUSE_LOOKBACK_DAYS,
    );
    expect(() =>
      retention.parseArgs(["node", "db-retention.js", "--audit-days=3"]),
    ).toThrow("exit 2");
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it.each([
    "--cache-days=0",
    "--cookie-days=0",
    "--lti-sync-days=10",
    "--operation-days=6",
    "--batch-size=0",
    "--batch-size=2.5",
    "--audit-days=abc",
    "--bogus",
  ])("rejects %s", (flag) => {
    expect(() =>
      retention.parseArgs(["node", "db-retention.js", flag]),
    ).toThrow("exit 2");
  });
});

describe("db-retention statements", () => {
  const now = new Date("2026-10-25T03:15:00Z");
  const steps = retention.buildSteps(retention.DEFAULTS, now, sql);
  const byName = Object.fromEntries(steps.map((step) => [step.name, step]));

  it("computes cutoffs from the windows", () => {
    expect(retention.cutoffFor(30, now).toISOString()).toBe(
      "2026-09-25T03:15:00.000Z",
    );
    expect(byName.grading_cache.cutoff).toEqual(retention.cutoffFor(30, now));
    expect(byName.grading_audit.cutoff).toEqual(retention.cutoffFor(60, now));
    expect(byName.lti_sync_cookies.cutoff).toEqual(retention.cutoffFor(7, now));
    expect(byName.lti_sync_rows.cutoff).toEqual(retention.cutoffFor(365, now));
    for (const name of [
      "operation_outbox",
      "operation_outbox_dead",
      "operations",
    ]) {
      expect(byName[name].cutoff).toEqual(retention.cutoffFor(30, now));
    }
  });

  it("blanks cookies before deleting anything, and sweeps the outbox before operations", () => {
    expect(steps.map((step) => step.name)).toEqual([
      "lti_sync_cookies",
      "grading_cache",
      "grading_audit",
      "lti_sync_rows",
      "operation_outbox",
      "operation_outbox_dead",
      "operations",
    ]);
    for (const step of steps) {
      const { text } = step.apply(step.cutoff, 10);
      expect(text).not.toMatch(/AssignmentAttempt"|QuestionResponse"/);
    }
  });

  it.each([
    ["lti_sync_cookies", "LtiGradeSync", "updatedAt", "UPDATE"],
    ["grading_cache", "GradingCache", "cachedAt", "DELETE"],
    ["grading_audit", "GradingAudit", "timestamp", "DELETE"],
    ["lti_sync_rows", "LtiGradeSync", "updatedAt", "DELETE"],
    ["operation_outbox", "operation_outbox", "sent_at", "DELETE"],
    ["operation_outbox_dead", "operation_outbox", "updated_at", "DELETE"],
    ["operations", "operation", "finished_at", "DELETE"],
  ])("%s is a bounded statement on %s.%s (%s)", (name, table, column, verb) => {
    const step = byName[name];
    const statement = step.apply(step.cutoff, 500);
    expect(
      statement.text.startsWith(`${verb} FROM "${table}"`) ||
        statement.text.startsWith(`${verb} "${table}"`),
    ).toBe(true);
    expect(statement.text).toContain(`"${column}" < ?`);
    expect(statement.text).toMatch(
      new RegExp(`ORDER BY "${column}" LIMIT \\? FOR UPDATE SKIP LOCKED\\)$`),
    );
    expect(statement.values).toEqual([step.cutoff, 500]);

    const count = step.count(step.cutoff);
    expect(count.text).toContain(`FROM "${table}" WHERE "${column}" < ?`);
    expect(count.values).toEqual([step.cutoff]);
  });

  it("never deletes an in-flight operation or outbox row", () => {
    // finished_at and sent_at are only set on terminal rows.
    const dead = byName.operation_outbox_dead;
    expect(dead.apply(dead.cutoff, 1).text).toContain(`"state" = 'dead'`);
    expect(dead.count(dead.cutoff).text).toContain(`"state" = 'dead'`);
    expect(byName.operations.apply(now, 1).text).not.toContain("state");
  });

  it("only blanks cookies that are still present", () => {
    const { text } = byName.lti_sync_cookies.apply(new Date(), 1);
    expect(text).toContain(`SET "authCookie" = ''`);
    expect(text).toContain(`"authCookie" <> ''`);
  });
});

describe("db-retention on a database without the operation tables", () => {
  const now = new Date("2026-10-25T03:15:00Z");
  // Shape of the error Prisma raises for a raw query on a missing relation.
  const undefinedTable = Object.assign(new Error("Raw query failed"), {
    code: "P2010",
    meta: { code: "42P01", message: 'relation "operation" does not exist' },
  });

  const fakePrisma = (failOn: (text: string) => Error | undefined) => {
    const tx: FakeTx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $executeRaw: jest.fn((statement: Statement) => {
        const error = failOn(statement.text);
        return error ? Promise.reject(error) : Promise.resolve(0);
      }),
      $queryRaw: jest.fn((statement: Statement) => {
        const error = failOn(statement.text);
        return error ? Promise.reject(error) : Promise.resolve([{ n: 0 }]);
      }),
    };
    return { prisma: { $transaction: (run) => run(tx) } as FakePrisma, tx };
  };
  const operationTables = (text: string) =>
    /"operation(_outbox)?"/.test(text) ? undefinedTable : undefined;

  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("recognises undefined_table and nothing else", () => {
    expect(retention.isUndefinedTable(undefinedTable)).toBe(true);
    expect(retention.isUndefinedTable({ code: "42P01" })).toBe(true);
    expect(
      retention.isUndefinedTable({ code: "P2010", meta: { code: "57014" } }),
    ).toBe(false);
    expect(retention.isUndefinedTable(new Error("boom"))).toBe(false);
    expect(retention.isUndefinedTable(undefined)).toBe(false);
  });

  it.each([true, false])(
    "skips the three operation steps and finishes the rest (dryRun %p)",
    async (dryRun) => {
      const args = { ...retention.DEFAULTS, dryRun };
      const steps = retention.buildSteps(args, now, sql);
      const { prisma, tx } = fakePrisma(operationTables);

      const summary = await retention.runSteps(prisma, steps, args, 0);

      expect(summary).toEqual({
        exhausted: false,
        skipped: ["operation_outbox", "operation_outbox_dead", "operations"],
      });
      for (const name of summary.skipped) {
        expect(warn).toHaveBeenCalledWith(
          `operations tables not present yet; skipping ${name}`,
        );
      }
      const run = dryRun ? tx.$queryRaw : tx.$executeRaw;
      expect(run).toHaveBeenCalledTimes(steps.length);
    },
  );

  it("still fails the run on any other error in an operation step", async () => {
    const args = { ...retention.DEFAULTS, dryRun: false };
    const steps = retention.buildSteps(args, now, sql);
    const timeout = Object.assign(new Error("canceling statement"), {
      code: "P2010",
      meta: { code: "57014" },
    });
    const { prisma } = fakePrisma((text) =>
      text.includes('"operation"') ? timeout : undefined,
    );

    await expect(retention.runSteps(prisma, steps, args, 0)).rejects.toBe(
      timeout,
    );
  });

  it("does not tolerate a missing table on the older steps", async () => {
    const args = { ...retention.DEFAULTS, dryRun: false };
    const steps = retention.buildSteps(args, now, sql);
    const { prisma } = fakePrisma((text) =>
      text.includes('"GradingCache"') ? undefinedTable : undefined,
    );

    await expect(retention.runSteps(prisma, steps, args, 0)).rejects.toBe(
      undefinedTable,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
