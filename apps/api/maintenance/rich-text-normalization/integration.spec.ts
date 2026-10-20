import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { convert } from "./converter";
import { connect, execute, rows } from "./database";
import { MigrationRunner } from "./runner";
import type { Run } from "./types";

jest.mock("canvas", () => null);
jest.setTimeout(60_000);
const url = process.env.RICH_TEXT_MIGRATION_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
    !/^\/mark_rich_text_migration_test_[a-zA-Z0-9_]+$/.test(parsed.pathname)
  )
    throw new Error(
      "Refusing integration tests outside a dedicated local migration test database",
    );
}
const integration = url ? describe : describe.skip;
const origin = "https://mark.example.test";
const legacy = '<p class="ql-indent-1 ql-align-center">old   saved answer</p>';
const converter = async (...arguments_: Parameters<typeof convert>) =>
  convert(...arguments_);

integration("PostgreSQL migration recovery", () => {
  const database = url ? connect(url) : undefined!;
  const runner = new MigrationRunner(
    database,
    url!,
    "postgres-integration",
    converter,
  );
  let target: string;
  const refresh = (run: Run) => runner.getRun(run.id, target);
  const plan = (scope = [1]) =>
    runner.plan(scope, origin, 4 * 1024 * 1024, target);
  const count = async (table: string) =>
    (
      await rows<{ count: number }>(
        database,
        `SELECT count(*)::int AS count FROM "${table}"`,
      )
    )[0].count;
  const stored = async () =>
    (
      await rows<{ introduction: string; updatedAt: Date }>(
        database,
        'SELECT introduction, "updatedAt" FROM "Assignment" WHERE id = 1',
      )
    )[0];
  beforeAll(async () => {
    const [identity] = await rows<{ database: string }>(
      database,
      "SELECT current_database() AS database",
    );
    if (!identity.database.startsWith("mark_rich_text_migration_test_"))
      throw new Error("unsafe-test-database");
    const schema = readFileSync(resolve(__dirname, "test-schema.sql"), "utf8");
    const ledger = readFileSync(
      resolve(
        __dirname,
        "../../prisma/migrations/20261014190000_rich_text_migration_ledger/migration.sql",
      ),
      "utf8",
    );
    for (const statement of (schema + "\n" + ledger)
      .split(";")
      .filter((part) => part.trim()))
      await execute(database, statement);
    target = (await runner.identity()).target;
  });
  afterAll(async () => {
    await database.$disconnect();
  });
  beforeEach(async () => {
    await execute(
      database,
      'TRUNCATE "FeedbackTranslation", "RichTextMigrationBackup", "RichTextMigrationItem", "RichTextMigrationLease", "RichTextMigrationRun", "QuestionResponse", "AssignmentAttempt", "AssignmentTranslation", "Translation", "QuestionVariant", "QuestionVersion", "Question", "AssignmentDraft", "AssignmentVersion", "Assignment" RESTART IDENTITY CASCADE',
    );
    await execute(
      database,
      "INSERT INTO \"Assignment\" (id, name, introduction) VALUES (1, 'test', $1), (2, 'outside scope', $1)",
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "AssignmentVersion" (id, "assignmentId", introduction) VALUES (10, 1, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "AssignmentDraft" (id, "assignmentId", introduction, "questionsData") VALUES (11, 1, $1, $2::jsonb)',
      legacy,
      JSON.stringify(
        JSON.stringify([
          {
            id: 7,
            question: legacy,
            variants: [{ variantContent: legacy }],
            scoring: { points: 10 },
          },
        ]),
      ),
    );
    await execute(
      database,
      'INSERT INTO "Question" (id, "assignmentId", question) VALUES (7, 1, $1), (8, 2, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "QuestionVersion" (id, "assignmentVersionId", "questionId", question) VALUES (12, 10, 7, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "QuestionVariant" (id, "questionId", "variantContent") VALUES (13, 7, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "Translation" (id, "questionId", "translatedText", "untranslatedText") VALUES (14, 7, $1, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "AssignmentTranslation" (id, "assignmentId", introduction, "translatedIntroduction") VALUES (15, 1, $1, $1)',
      legacy,
    );
    await execute(
      database,
      'INSERT INTO "AssignmentAttempt" (id, "assignmentId", "assignmentVersionId") VALUES (17, 1, 10)',
    );
    await execute(
      database,
      'INSERT INTO "QuestionResponse" (id, "assignmentAttemptId", "questionId", "learnerResponse") VALUES (16, 17, 7, $1)',
      JSON.stringify(legacy),
    );
  });

  it("audits every covered model without creating ledger rows or changing values", async () => {
    const report = await runner.audit([1], origin, 4 * 1024 * 1024);
    expect(report.pending).toBe(9);
    expect(Object.keys(report.models)).toHaveLength(10);
    expect(await count("RichTextMigrationRun")).toBe(0);
    expect(await count("RichTextMigrationBackup")).toBe(0);
    expect((await stored()).introduction).toBe(legacy);
  });
  it("applies all representations, preserves grades/timestamps, and leaves another assignment unchanged", async () => {
    const run = await plan();
    const original = await stored();
    const [evidence] = await rows(
      database,
      'SELECT points::text, feedback, "gradedAt" FROM "QuestionResponse" WHERE id = 16',
    );
    await runner.apply(run, 100);
    expect(await count("RichTextMigrationBackup")).toBe(9);
    expect((await stored()).introduction).not.toContain("ql-");
    expect((await stored()).updatedAt).toEqual(original.updatedAt);
    expect(
      (
        await rows(
          database,
          'SELECT points::text, feedback, "gradedAt" FROM "QuestionResponse" WHERE id = 16',
        )
      )[0],
    ).toEqual(evidence);
    expect(
      (
        await rows<{ introduction: string }>(
          database,
          'SELECT introduction FROM "Assignment" WHERE id = 2',
        )
      )[0].introduction,
    ).toBe(legacy);
    const [draft] = await rows<{ data: string }>(
      database,
      'SELECT "questionsData"::text AS data FROM "AssignmentDraft" WHERE id = 11',
    );
    expect(typeof JSON.parse(draft.data)).toBe("string");
    expect(draft.data).not.toContain("ql-");
    expect((await runner.audit([1], origin, 4 * 1024 * 1024)).pending).toBe(0);
  });
  it("preserves native JSON numeric precision and detects legacy markup in feedback", async () => {
    await execute(
      database,
      'UPDATE "AssignmentDraft" SET "questionsData" = $1::jsonb WHERE id = 11',
      '[{"id":9007199254740993123,"fraction":1.234567890123456789,"question":' +
        JSON.stringify(legacy) +
        "}]",
    );
    await execute(
      database,
      'INSERT INTO "FeedbackTranslation" (id, "questionId", "translatedFeedback", "untranslatedFeedback") VALUES (19, 7, $1::jsonb, $1::jsonb)',
      JSON.stringify({ feedback: legacy }),
    );
    const run = await plan();
    await runner.apply(run, 100);
    const [draft] = await rows<{ data: string }>(
      database,
      'SELECT "questionsData"::text AS data FROM "AssignmentDraft" WHERE id = 11',
    );
    expect(draft.data).toContain("9007199254740993123");
    expect(draft.data).toContain("1.234567890123456789");
    expect(draft.data).not.toContain("ql-");
    expect((await runner.verify(await refresh(run), true, true)).clean).toBe(
      false,
    );
    const [feedback] = await rows<{ data: string }>(
      database,
      'SELECT "translatedFeedback"::text AS data FROM "FeedbackTranslation" WHERE id = 19',
    );
    expect(feedback.data).toContain("ql-");
    await runner.rollback(await refresh(run));
    const [restored] = await rows<{ data: string }>(
      database,
      'SELECT "questionsData"::text AS data FROM "AssignmentDraft" WHERE id = 11',
    );
    expect(restored.data).toContain("9007199254740993123");
    expect(restored.data).toContain("ql-");
  });
  it("quarantines old responses whose historical type is missing", async () => {
    await execute(database, 'DELETE FROM "QuestionVersion" WHERE id = 12');
    const run = await plan();
    await runner.apply(run, 100);
    const [response] = await rows<{ learnerResponse: string }>(
      database,
      'SELECT "learnerResponse" FROM "QuestionResponse" WHERE id = 16',
    );
    expect(response.learnerResponse).toBe(JSON.stringify(legacy));
    expect(
      (await runner.verify(await refresh(run), true, true)).reasons,
    ).toEqual({ "ambiguous-response-context": 1 });
  });
  it.each(["before-backup", "backup", "update", "commit"])(
    "resumes after SIGKILL at %s without a partial write or duplicate backup",
    async (phase) => {
      const run = await plan();
      const script = `const{connect}=require('./maintenance/rich-text-normalization/database');const{MigrationRunner}=require('./maintenance/rich-text-normalization/runner');const{convert}=require('./maintenance/rich-text-normalization/converter');const d=connect(process.env.RICH_TEXT_MIGRATION_TEST_URL);const r=new MigrationRunner(d,process.env.RICH_TEXT_MIGRATION_TEST_URL,'postgres-integration',async(...a)=>convert(...a),p=>{if(p===${JSON.stringify(phase)})process.kill(process.pid,'SIGKILL')});r.getRun(${JSON.stringify(run.id)},${JSON.stringify(target)}).then(run=>r.apply(run,100)).catch(()=>process.exit(1));`;
      const child = spawn(
        process.execPath,
        ["-r", "ts-node/register/transpile-only", "-e", script],
        {
          cwd: resolve(__dirname, "../.."),
          env: {
            ...process.env,
            TS_NODE_PROJECT: "tsconfig.rich-text-migration.json",
          },
          stdio: "ignore",
        },
      );
      const signal = await new Promise<NodeJS.Signals | null>(
        (resolveExit, reject) => {
          child.once("error", reject);
          child.once("exit", (_code, stoppedBy) => resolveExit(stoppedBy));
        },
      );
      expect(signal).toBe("SIGKILL");
      expect(await count("RichTextMigrationBackup")).toBe(
        phase === "commit" ? 1 : 0,
      );
      expect((await stored()).introduction === legacy).toBe(phase !== "commit");
      await execute(
        database,
        'UPDATE "RichTextMigrationLease" SET "expiresAt" = clock_timestamp() - interval \'1 second\'',
      );
      await runner.resume(await refresh(run), 100);
      expect(await count("RichTextMigrationBackup")).toBe(9);
    },
  );
  it("keeps the canary limit across restarts and rejects an incorrect target or build", async () => {
    const run = await plan();
    await runner.apply(run, 1);
    await runner.resume(await refresh(run), 1);
    expect(await count("RichTextMigrationBackup")).toBe(1);
    await expect(runner.getRun(run.id, "another-target")).rejects.toThrow(
      "target-mismatch",
    );
    const different = new MigrationRunner(
      database,
      url!,
      "different-build",
      converter,
    );
    await expect(different.getRun(run.id, target)).rejects.toThrow(
      "artifact-or-schema-mismatch",
    );
  });
  it("waits for a transient row lock and retries without duplicate backups", async () => {
    const run = await plan();
    let locked!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolveReady) => {
      locked = resolveReady;
    });
    const wait = new Promise<void>((resolveWait) => {
      release = resolveWait;
    });
    const blocker = database.$transaction(
      async (transaction) => {
        await rows(
          transaction,
          'SELECT id FROM "Assignment" WHERE id = 1 FOR UPDATE',
        );
        locked();
        await wait;
      },
      { timeout: 10_000 },
    );
    await ready;
    const application = runner.apply(run, 100);
    const deadline = Date.now() + 5_000;
    let attempted = false;
    try {
      while (Date.now() < deadline) {
        const [item] = await rows<{ attempts: number }>(
          database,
          'SELECT attempts FROM "RichTextMigrationItem" WHERE "runId" = $1 AND model = \'Assignment\' AND "rowId" = 1',
          run.id,
        );
        if (item.attempts > 0) {
          attempted = true;
          break;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
      }
    } finally {
      release();
      await blocker;
    }
    await application;
    expect(attempted).toBe(true);
    expect(await count("RichTextMigrationBackup")).toBe(9);
    expect((await stored()).introduction).not.toContain("ql-");
  });
  it("does not overwrite a live edit and revalidates its replacement on retry", async () => {
    const run = await plan();
    const edited = legacy.replace("old", "new user edit");
    await execute(
      database,
      'UPDATE "Assignment" SET introduction = $1 WHERE id = 1',
      edited,
    );
    await runner.apply(run, 100);
    expect((await stored()).introduction).toBe(edited);
    expect((await runner.status(run)).items).toContainEqual({
      state: "conflict",
      count: 1,
    });
    await runner.retryConflicts(await refresh(run));
    await runner.resume(await refresh(run), 100);
    expect((await stored()).introduction).toContain("new user edit");
    expect((await stored()).introduction).not.toContain("ql-");
  });
  it("fences a stale worker and excludes an overlapping execution", async () => {
    const run = await plan();
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      entered = resolveStarted;
    });
    const wait = new Promise<void>((resolveWait) => {
      release = resolveWait;
    });
    const slow = new MigrationRunner(
      database,
      url!,
      "postgres-integration",
      async (...arguments_) => {
        entered();
        await wait;
        return convert(...arguments_);
      },
    );
    const first = slow.apply(await refresh(run), 100).then(
      () => null,
      (error: Error) => error.message,
    );
    await started;
    await expect(runner.apply(await refresh(run), 100)).rejects.toThrow(
      "migration-lease-held",
    );
    await execute(
      database,
      'UPDATE "RichTextMigrationLease" SET "expiresAt" = clock_timestamp() - interval \'1 second\'',
    );
    await runner.resume(await refresh(run), 100);
    release();
    expect(await first).toBe("worker-stopped-or-lease-lost");
    expect(await count("RichTextMigrationBackup")).toBe(9);
  });
  it("keeps repeated source history visible instead of creating a successor cycle", async () => {
    const run = await plan();
    await execute(
      database,
      'UPDATE "Assignment" SET introduction = $1 WHERE id = 1',
      legacy.replace("old", "changed"),
    );
    await runner.apply(run, 100);
    await runner.retryConflicts(await refresh(run));
    await execute(
      database,
      'UPDATE "Assignment" SET introduction = $1 WHERE id = 1',
      legacy,
    );
    await runner.resume(await refresh(run), 100);
    await runner.retryConflicts(await refresh(run));
    const [item] = await rows<{ reason: string }>(
      database,
      'SELECT reason FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state = \'quarantined\'',
      run.id,
    );
    expect(item.reason).toBe("source-history-repeated");
    expect((await stored()).introduction).toBe(legacy);
    expect((await runner.verify(await refresh(run), true, true)).clean).toBe(
      false,
    );
  });
  it("pause stops application and explicit resume preserves progress", async () => {
    const run = await plan();
    await runner.apply(run, 1);
    await runner.pause(await refresh(run));
    await expect(runner.apply(await refresh(run), 100)).rejects.toThrow(
      "run-is-paused",
    );
    await runner.resume(await refresh(run), 100);
    expect(await count("RichTextMigrationBackup")).toBe(9);
  });
  it("quarantines colliding variants instead of merging or deleting them", async () => {
    await execute(
      database,
      'INSERT INTO "QuestionVariant" (id, "questionId", "variantContent") VALUES (18, 7, $1)',
      legacy.replace(
        "ql-indent-1 ql-align-center",
        "ql-align-center ql-indent-1",
      ),
    );
    const run = await plan();
    await runner.apply(run, 100);
    expect(await count("QuestionVariant")).toBe(2);
    expect((await runner.status(run)).items).toContainEqual({
      state: "quarantined",
      count: 2,
    });
  });
  it("rolls back conditionally without overwriting later edits or recreating deleted rows", async () => {
    const run = await plan();
    await runner.apply(run, 100);
    await execute(
      database,
      "UPDATE \"Assignment\" SET name = 'later name', introduction = 'later document' WHERE id = 1",
    );
    await execute(database, 'DELETE FROM "Translation" WHERE id = 14');
    await runner.rollback(await refresh(run));
    expect((await stored()).introduction).toBe("later document");
    expect(
      (
        await rows<{ question: string }>(
          database,
          'SELECT question FROM "Question" WHERE id = 7',
        )
      )[0].question,
    ).toBe(legacy);
    expect(await count("Translation")).toBe(0);
    expect((await runner.status(run)).status).toBe("needs_review");
    await expect(runner.resume(await refresh(run), 100)).rejects.toThrow(
      "run-is-rolling-back",
    );
  });
  it("converts pre-versioning responses using the question's current type", async () => {
    await execute(
      database,
      'INSERT INTO "AssignmentAttempt" (id, "assignmentId", "assignmentVersionId") VALUES (18, 1, NULL)',
    );
    await execute(
      database,
      'INSERT INTO "QuestionResponse" (id, "assignmentAttemptId", "questionId", "learnerResponse") VALUES (19, 18, 7, $1)',
      JSON.stringify(legacy),
    );
    const run = await plan();
    await runner.apply(run, 100);
    const [response] = await rows<{ learnerResponse: string }>(
      database,
      'SELECT "learnerResponse" FROM "QuestionResponse" WHERE id = 19',
    );
    expect(response.learnerResponse).not.toContain("ql-");
    expect(JSON.parse(response.learnerResponse)).toContain("old   saved");
    const [item] = await rows<{ state: string; context: string }>(
      database,
      `SELECT state, context FROM "RichTextMigrationItem" WHERE model = 'QuestionResponse' AND "rowId" = 19`,
    );
    expect(item.state).toBe("applied");
    expect(JSON.parse(item.context)).toMatchObject({
      types: ["TEXT"],
      typeSource: "question",
    });
    await execute(database, "UPDATE \"Question\" SET type = 'UPLOAD'");
    await execute(
      database,
      'UPDATE "QuestionResponse" SET "learnerResponse" = $1 WHERE id = 19',
      JSON.stringify(legacy),
    );
    expect(
      (await runner.audit([1], origin, 4 * 1024 * 1024)).models
        .QuestionResponse,
    ).toMatchObject({ pending: 0, quarantined: 0 });
  });
  it("rolls back each field that still holds its replacement and keeps later edits", async () => {
    const run = await plan();
    await runner.apply(run, 100);
    await execute(
      database,
      `UPDATE "AssignmentTranslation" SET "translatedIntroduction" = 'later translation' WHERE id = 15`,
    );
    await runner.rollback(await refresh(run));
    const [translation] = await rows<{
      introduction: string;
      translatedIntroduction: string;
    }>(
      database,
      'SELECT introduction, "translatedIntroduction" FROM "AssignmentTranslation" WHERE id = 15',
    );
    expect(translation).toEqual({
      introduction: legacy,
      translatedIntroduction: "later translation",
    });
    const states = await rows<{ rollbackState: string; count: number }>(
      database,
      'SELECT "rollbackState", count(*)::int AS count FROM "RichTextMigrationBackup" GROUP BY 1 ORDER BY 1',
    );
    expect(states).toEqual([
      { rollbackState: "partial", count: 1 },
      { rollbackState: "restored", count: 8 },
    ]);
    expect((await runner.status(run)).status).toBe("needs_review");
    await runner.rollback(await refresh(run));
    expect(
      (
        await rows<{ translatedIntroduction: string }>(
          database,
          'SELECT "translatedIntroduction" FROM "AssignmentTranslation" WHERE id = 15',
        )
      )[0].translatedIntroduction,
    ).toBe("later translation");
  });
  it("returns paused instead of failing when an operator pauses a running worker", async () => {
    const slow = new MigrationRunner(
      database,
      url!,
      "postgres-integration",
      async (...arguments_) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return convert(...arguments_);
      },
    );
    const run = await plan();
    const applying = slow.apply(await refresh(run), 100);
    while ((await count("RichTextMigrationBackup")) < 1)
      await new Promise((resolve) => setTimeout(resolve, 20));
    await runner.pause(await refresh(run));
    await expect(applying).resolves.toBe("paused");
    expect(await count("RichTextMigrationBackup")).toBeLessThan(9);
    await expect(runner.resume(await refresh(run), 100)).resolves.toBe(
      "finished",
    );
    expect(await count("RichTextMigrationBackup")).toBe(9);
  });
  it("retries parser timeouts instead of quarantining the row permanently", async () => {
    let timeouts = 2;
    const flaky = new MigrationRunner(
      database,
      url!,
      "postgres-integration",
      async (model, snapshot, origin_) => {
        if (model.name === "Question" && timeouts > 0) {
          timeouts--;
          return {
            state: "quarantined",
            before: snapshot.values,
            after: snapshot.values,
            rules: [],
            reason: "parser-timeout",
          };
        }
        return convert(model, snapshot, origin_);
      },
    );
    const run = await flaky.plan([1], origin, 4 * 1024 * 1024, target);
    expect((await flaky.status(run)).items).toContainEqual({
      state: "retryable",
      count: 1,
    });
    await flaky.apply(await flaky.getRun(run.id, target), 100);
    expect(await count("RichTextMigrationBackup")).toBe(9);
    expect(
      (
        await rows<{ question: string }>(
          database,
          'SELECT question FROM "Question" WHERE id = 7',
        )
      )[0].question,
    ).not.toContain("ql-");

    await execute(
      database,
      'UPDATE "Question" SET question = $1 WHERE id = 7',
      legacy,
    );
    const second = await plan();
    await execute(
      database,
      `UPDATE "RichTextMigrationItem" SET state = 'quarantined', reason = 'parser-timeout' WHERE "runId" = $1 AND model = 'Question'`,
      second.id,
    );
    await runner.retryConflicts(await refresh(second));
    await runner.apply(await refresh(second), 100);
    expect(
      (
        await rows<{ state: string }>(
          database,
          `SELECT state FROM "RichTextMigrationItem" WHERE "runId" = $1 AND model = 'Question'`,
          second.id,
        )
      )[0].state,
    ).toBe("applied");
  });
  it("detects backup tampering and requires two attested clean sweeps for global completion", async () => {
    const run = await plan([]);
    await runner.apply(run, 100);
    expect(
      (await runner.verify(await refresh(run), false, false)).retirementReady,
    ).toBe(false);
    expect(
      (await runner.verify(await refresh(run), true, true)).retirementReady,
    ).toBe(false);
    expect(
      (await runner.verify(await refresh(run), true, true)).retirementReady,
    ).toBe(true);
    await execute(
      database,
      "UPDATE \"RichTextMigrationBackup\" SET before = '{}'::jsonb",
    );
    await expect(runner.rollback(await refresh(run))).rejects.toThrow(
      "backup-integrity-failed",
    );
  });
});
