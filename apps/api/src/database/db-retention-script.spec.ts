// The db-retention CronJob deletes rows by age, so its windows and statement
// shapes are pinned here: every sweep must stay bounded, use the indexed age
// column, and never drop below what the product still reads.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const retention = require("../../../../scripts/db-retention.js") as {
  parseArgs: (argv: string[]) => Args;
  cutoffFor: (days: number, now: Date) => Date;
  buildSteps: (args: Args, now: Date, sql: SqlTag) => Step[];
  runStep: (
    prisma: unknown,
    step: Step,
    args: Args,
    deadline: number,
  ) => Promise<{ total: number; batches: number; exhausted: boolean }>;
  sweepChatFiles: (
    store: FileStore,
    options: { cutoff: Date; dryRun: boolean; deadline: number },
  ) => Promise<{
    matched: number;
    deleted: number;
    failed: number;
    exhausted: boolean;
  }>;
  createChatFileStore: (env: Record<string, string>) => FileStore | null;
  DEFAULTS: Args;
  MIN_DAYS: Record<string, number>;
};

type Args = {
  dryRun: boolean;
  cacheDays: number;
  auditDays: number;
  cookieDays: number;
  ltiSyncDays: number;
  chatDays: number;
  chatFileDays: number;
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
  cutoff: Date;
  count: (cutoff: Date) => Statement;
  apply: (cutoff: Date, limit: number) => Statement;
  maxBatch?: number;
};

type StoredFile = { Key: string; LastModified: Date };
type FileStore = {
  list: (
    prefix: string,
    token?: string,
  ) => Promise<{ files: StoredFile[]; nextToken?: string }>;
  remove: (key: string) => Promise<void>;
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
      chatDays: 30,
      chatFileDays: 30,
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
    ]);
    expect(args.dryRun).toBe(false);
    expect(args.cacheDays).toBe(45);
    expect(args.auditDays).toBe(90);
    expect(args.batchSize).toBe(100);
    expect(args.maxSeconds).toBe(0);
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
    "--chat-days=0",
    "--chat-file-days=0",
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
    expect(byName.chats.cutoff).toEqual(retention.cutoffFor(30, now));
  });

  it("blanks cookies before deleting anything, and only touches the byproduct tables", () => {
    expect(steps.map((step) => step.name)).toEqual([
      "lti_sync_cookies",
      "grading_cache",
      "grading_audit",
      "lti_sync_rows",
      "chats",
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
    ["chats", "Chat", "lastActiveAt", "DELETE"],
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

  it("only blanks cookies that are still present", () => {
    const { text } = byName.lti_sync_cookies.apply(new Date(), 1);
    expect(text).toContain(`SET "authCookie" = ''`);
    expect(text).toContain(`"authCookie" <> ''`);
  });
});

describe("db-retention batching", () => {
  const now = new Date("2026-10-25T03:15:00Z");

  it("deletes chats in small batches because each one cascades to its messages", async () => {
    const steps = retention.buildSteps(retention.DEFAULTS, now, sql);
    const chats = steps.find((step) => step.name === "chats") as Step;
    const limits: unknown[] = [];
    const tx = {
      $executeRawUnsafe: () => Promise.resolve(0),
      $executeRaw: (statement: Statement) => {
        limits.push(statement.values[1]);
        return Promise.resolve(limits.length === 1 ? chats.maxBatch : 0);
      },
    };
    const prisma = {
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    };
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await retention.runStep(
      prisma,
      chats,
      { ...retention.DEFAULTS, pauseMs: 0 },
      0,
    );

    expect(chats.maxBatch).toBeLessThan(retention.DEFAULTS.batchSize);
    expect(limits).toEqual([chats.maxBatch, chats.maxBatch]);
    expect(result.total).toBe(chats.maxBatch);
    expect(result.batches).toBe(2);
    jest.restoreAllMocks();
  });
});

describe("db-retention chat attachment sweep", () => {
  const cutoff = new Date("2026-09-25T00:00:00Z");
  const old = new Date("2026-01-01T00:00:00Z");
  const recent = new Date("2026-10-20T00:00:00Z");

  // Behaves like a bucket: list honours the prefix and pages its results.
  const bucketWith = (files: StoredFile[], pageSize = 1000) => {
    const stored = new Map(files.map((file) => [file.Key, file]));
    const store: FileStore = {
      list: (prefix, token) => {
        const matching = [...stored.values()]
          .filter((file) => file.Key.startsWith(prefix))
          .sort((a, b) => a.Key.localeCompare(b.Key))
          .filter((file) => !token || file.Key > token);
        const page = matching.slice(0, pageSize);
        return Promise.resolve({
          files: page,
          nextToken:
            matching.length > pageSize ? page[page.length - 1].Key : undefined,
        });
      },
      remove: (key) => {
        stored.delete(key);
        return Promise.resolve();
      },
    };
    return { store, keys: () => [...stored.keys()].sort() };
  };

  it("deletes old chat attachments and leaves learner answers alone", async () => {
    const { store, keys } = bucketWith([
      { Key: "chatbot/a@example.test/old.pdf", LastModified: old },
      { Key: "chatbot/a@example.test/new.pdf", LastModified: recent },
      { Key: "3670/a@example.test/answer.pdf", LastModified: old },
      { Key: "chatbot-exports/old.csv", LastModified: old },
    ]);

    const result = await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: false,
      deadline: 0,
    });

    expect(keys()).toEqual([
      "3670/a@example.test/answer.pdf",
      "chatbot-exports/old.csv",
      "chatbot/a@example.test/new.pdf",
    ]);
    expect(result).toEqual({
      matched: 1,
      deleted: 1,
      failed: 0,
      exhausted: false,
    });
  });

  it("refuses a key outside the prefix even if the listing returns one", async () => {
    const removed: string[] = [];
    const store: FileStore = {
      list: () =>
        Promise.resolve({
          files: [{ Key: "3670/a@example.test/answer.pdf", LastModified: old }],
        }),
      remove: (key) => {
        removed.push(key);
        return Promise.resolve();
      },
    };

    await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: false,
      deadline: 0,
    });

    expect(removed).toEqual([]);
  });

  it("only counts on a dry run", async () => {
    const { store, keys } = bucketWith([
      { Key: "chatbot/a@example.test/old.pdf", LastModified: old },
    ]);

    const result = await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: true,
      deadline: 0,
    });

    expect(keys()).toEqual(["chatbot/a@example.test/old.pdf"]);
    expect(result.matched).toBe(1);
    expect(result.deleted).toBe(0);
  });

  it("walks every page", async () => {
    const files = Array.from({ length: 7 }, (_, index) => ({
      Key: `chatbot/a@example.test/${index}.pdf`,
      LastModified: old,
    }));
    const { store, keys } = bucketWith(files, 3);

    const result = await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: false,
      deadline: 0,
    });

    expect(keys()).toEqual([]);
    expect(result.deleted).toBe(7);
  });

  it("stops at the deadline and reports work remaining", async () => {
    const { store, keys } = bucketWith([
      { Key: "chatbot/a@example.test/old.pdf", LastModified: old },
    ]);

    const result = await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: false,
      deadline: Date.now() - 1000,
    });

    expect(result.exhausted).toBe(true);
    expect(keys()).toHaveLength(1);
  });

  it("keeps going past a failed delete and counts it", async () => {
    const { store, keys } = bucketWith([
      { Key: "chatbot/a@example.test/1.pdf", LastModified: old },
      { Key: "chatbot/a@example.test/2.pdf", LastModified: old },
    ]);
    const remove = store.remove;
    store.remove = (key) =>
      key.endsWith("1.pdf")
        ? Promise.reject(new Error("AccessDenied"))
        : remove(key);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {
      return undefined;
    });

    const result = await retention.sweepChatFiles(store, {
      cutoff,
      dryRun: false,
      deadline: 0,
    });

    expect(keys()).toEqual(["chatbot/a@example.test/1.pdf"]);
    expect(result).toMatchObject({ deleted: 1, failed: 1 });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("example.test");
    jest.restoreAllMocks();
  });

  it("has no store when the bucket is not configured", () => {
    expect(retention.createChatFileStore({})).toBeNull();
  });
});
