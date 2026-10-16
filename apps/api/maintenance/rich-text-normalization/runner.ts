import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  databaseTarget,
  digest,
  execute,
  lockSource,
  readSnapshot,
  replaceValues,
  rows,
  schemaFingerprint,
  sizeSql,
  type Database,
} from "./database";
import { isolatedConvert } from "./isolated-converter";
import { from, modelByName, MODELS, scopeClause } from "./manifest";
import type { Conversion, Item, Model, Run, Snapshot, Values } from "./types";

type Convert = (
  model: Model,
  snapshot: Snapshot,
  origin: string,
) => Promise<Conversion>;
interface Lease {
  owner: string;
  generation: bigint;
  key: string;
  runId: string;
}
interface Report {
  scanned: number;
  pending: number;
  unchanged: number;
  quarantined: number;
  reasons: Record<string, number>;
  models: Record<
    string,
    { scanned: number; pending: number; quarantined: number }
  >;
}
interface Backup {
  id: string;
  sequence: bigint;
  before: Values;
  after: Values;
  beforeHash: string;
  afterHash: string;
  itemId: string;
  model: string;
  rowId: number;
}
const MAX_ATTEMPTS = 5;
const INITIAL_CURSOR = -2_147_483_649;
const LEASE_KEY = "rich-text-normalization";

export class MigrationRunner {
  private lease?: Lease;
  private heartbeat?: ReturnType<typeof setInterval>;
  private heartbeatTask: Promise<void> = Promise.resolve();
  private lostLease = false;
  private stopping = false;
  constructor(
    readonly database: PrismaClient,
    readonly url: string,
    readonly artifactHash: string,
    readonly converter: Convert = isolatedConvert,
    readonly fault?: (
      phase: "before-backup" | "backup" | "update" | "commit",
    ) => void,
    readonly emit?: (event: Record<string, unknown>) => void,
  ) {}

  async identity() {
    return {
      target: await databaseTarget(this.database, this.url),
      fingerprint: digest({
        artifact: this.artifactHash,
        schema: await schemaFingerprint(this.database),
      }),
    };
  }

  async audit(
    scope: number[],
    origin: string,
    byteLimit: number,
  ): Promise<Report> {
    const report: Report = {
      scanned: 0,
      pending: 0,
      unchanged: 0,
      quarantined: 0,
      reasons: {},
      models: {},
    };
    for (const model of MODELS) {
      const [upper] = await this.readOnly((database) =>
        rows<{ upper: number }>(
          database,
          `SELECT COALESCE(max(r.id), 0)::int AS upper ${from(model)} WHERE ${scopeClause(model)}`,
          scope.length > 0 ? scope : null,
        ),
      );
      let cursor = INITIAL_CURSOR;
      const counts = (report.models[model.name] = {
        scanned: 0,
        pending: 0,
        quarantined: 0,
      });
      for (;;) {
        if (this.stopping) throw new Error("worker-stopped-or-lease-lost");
        const page = await this.page(model, scope, cursor, upper.upper);
        if (page.length === 0) break;
        for (const row of page) {
          const { conversion } = await this.inspect(
            model,
            row.id,
            scope,
            origin,
            byteLimit,
            true,
          );
          if (!conversion) continue;
          report.scanned++;
          counts.scanned++;
          report[conversion.state]++;
          if (conversion.state !== "unchanged") counts[conversion.state]++;
          if (conversion.reason)
            report.reasons[conversion.reason] =
              (report.reasons[conversion.reason] ?? 0) + 1;
        }
        cursor = page.at(-1)?.id ?? cursor;
      }
    }
    return report;
  }

  private async readOnly<T>(
    operation: (database: Database) => Promise<T>,
  ): Promise<T> {
    return this.database.$transaction(
      async (database) => {
        await execute(database, "SET TRANSACTION READ ONLY");
        return operation(database);
      },
      { timeout: 10_000 },
    );
  }

  private page(model: Model, scope: number[], cursor: number, upper: number) {
    return this.readOnly((database) =>
      rows<{ id: number; bytes: bigint }>(
        database,
        `SELECT r.id, (${sizeSql(model)}) AS bytes ${from(model)} WHERE ${scopeClause(model)} AND r.id > $2::bigint AND r.id <= $3 ORDER BY r.id LIMIT 100`,
        scope.length > 0 ? scope : null,
        cursor,
        upper,
      ),
    );
  }

  private async inspect(
    model: Model,
    id: number,
    scope: number[],
    origin: string,
    byteLimit: number,
    readOnly = false,
  ) {
    let snapshot: Snapshot | undefined;
    try {
      snapshot = readOnly
        ? await this.readOnly((database) =>
            readSnapshot(database, model, id, scope, byteLimit),
          )
        : await readSnapshot(this.database, model, id, scope, byteLimit);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "document-size-limit")
        throw error;
      return {
        snapshot: undefined,
        conversion: {
          state: "quarantined",
          before: {},
          after: {},
          reason: "document-size-limit",
          rules: [],
        } as Conversion,
      };
    }
    const conversion = snapshot
      ? await this.converter(model, snapshot, origin)
      : undefined;
    if (
      conversion &&
      [
        ...Object.values(conversion.after),
        ...Object.values(snapshot?.extra ?? {}),
      ].reduce(
        (bytes, value) => bytes + Buffer.byteLength(value ?? "", "utf8"),
        0,
      ) > byteLimit
    ) {
      conversion.state = "quarantined";
      conversion.reason = "output-size-limit";
      conversion.after = conversion.before;
    }
    return { snapshot, conversion };
  }

  async plan(
    scope: number[],
    origin: string,
    byteLimit: number,
    expectedTarget: string,
  ): Promise<Run> {
    const identity = await this.identity();
    if (identity.target !== expectedTarget) throw new Error("target-mismatch");
    const id = randomUUID();
    const [run] = await rows<Run>(
      this.database,
      'INSERT INTO "RichTextMigrationRun" (id, target, fingerprint, scope, origin, "byteLimit") VALUES ($1, $2, $3, $4::int[], $5, $6) RETURNING *',
      id,
      identity.target,
      identity.fingerprint,
      scope,
      origin,
      byteLimit,
    );
    this.emit?.({ event: "run-created", run: id, target: identity.target });
    await this.withLease(run, () => this.discover(run));
    return this.getRun(id, expectedTarget);
  }

  async getRun(id: string, expectedTarget: string): Promise<Run> {
    const [run] = await rows<Run>(
      this.database,
      'SELECT * FROM "RichTextMigrationRun" WHERE id = $1',
      id,
    );
    if (!run) throw new Error("run-not-found");
    const identity = await this.identity();
    if (identity.target !== expectedTarget || run.target !== identity.target)
      throw new Error("target-mismatch");
    if (run.fingerprint !== identity.fingerprint)
      throw new Error("artifact-or-schema-mismatch");
    return run;
  }

  private async withLease<T>(
    run: Run,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.lease) throw new Error("worker-already-running");
    if (this.stopping) throw new Error("worker-stopped-or-lease-lost");
    const key = LEASE_KEY;
    const owner = randomUUID();
    const [lease] = await rows<{ generation: bigint }>(
      this.database,
      `INSERT INTO "RichTextMigrationLease" (key, "runId", owner, generation, "expiresAt") VALUES ($1, $2, $3, 1, clock_timestamp() + interval '90 seconds') ON CONFLICT (key) DO UPDATE SET "runId" = EXCLUDED."runId", owner = EXCLUDED.owner, generation = "RichTextMigrationLease".generation + 1, "expiresAt" = EXCLUDED."expiresAt" WHERE "RichTextMigrationLease"."expiresAt" <= clock_timestamp() RETURNING generation`,
      key,
      run.id,
      owner,
    );
    if (!lease) throw new Error("migration-lease-held");
    this.lease = { key, owner, generation: lease.generation, runId: run.id };
    this.lostLease = false;
    this.heartbeat = setInterval(() => {
      this.heartbeatTask = this.heartbeatTask
        .then(async () => {
          const changed = await execute(
            this.database,
            `UPDATE "RichTextMigrationLease" SET "expiresAt" = clock_timestamp() + interval '90 seconds' WHERE key = $1 AND owner = $2 AND generation = $3 AND "expiresAt" > clock_timestamp()`,
            key,
            owner,
            lease.generation,
          );
          if (changed !== 1) this.lostLease = true;
        })
        .catch(() => {
          this.lostLease = true;
        });
    }, 15_000);
    try {
      const [fresh] = await rows<Run>(
        this.database,
        'SELECT * FROM "RichTextMigrationRun" WHERE id = $1',
        run.id,
      );
      Object.assign(run, fresh);
      return await operation();
    } finally {
      clearInterval(this.heartbeat);
      await this.heartbeatTask;
      try {
        await execute(
          this.database,
          'UPDATE "RichTextMigrationLease" SET owner = NULL, "expiresAt" = clock_timestamp() WHERE key = $1 AND owner = $2 AND generation = $3',
          key,
          owner,
          lease.generation,
        );
      } finally {
        this.lease = undefined;
      }
    }
  }

  private async transaction<T>(
    operation: (database: Database) => Promise<T>,
    allowPaused = false,
  ): Promise<T> {
    if (!this.lease || this.lostLease || this.stopping)
      throw new Error("worker-stopped-or-lease-lost");
    const lease = this.lease;
    return this.database.$transaction(
      async (database) => {
        await execute(database, "SET LOCAL lock_timeout = '500ms'");
        await execute(database, "SET LOCAL statement_timeout = '5s'");
        const [live] = await rows<{ valid: boolean }>(
          database,
          'SELECT (owner = $2 AND generation = $3 AND "runId" = $4 AND "expiresAt" > clock_timestamp()) AS valid FROM "RichTextMigrationLease" WHERE key = $1 FOR UPDATE',
          lease.key,
          lease.owner,
          lease.generation,
          lease.runId,
        );
        const [run] = await rows<{ status: string }>(
          database,
          'SELECT status FROM "RichTextMigrationRun" WHERE id = $1 FOR UPDATE',
          lease.runId,
        );
        if (!live?.valid || (run.status === "paused" && !allowPaused))
          throw new Error("worker-stopped-or-lease-lost");
        return operation(database);
      },
      { timeout: 8000 },
    );
  }

  private async insertItem(
    database: Database,
    run: Run,
    model: Model,
    id: number,
    snapshot: Snapshot | undefined,
    conversion: Conversion,
  ) {
    const sourceHash = digest(snapshot ?? { oversized: id });
    const destinationHash =
      model.name === "QuestionVariant" && conversion.state === "pending"
        ? digest({
            context: snapshot?.context,
            content: conversion.after.variantContent,
          })
        : null;
    const [item] = await rows<Item>(
      database,
      `INSERT INTO "RichTextMigrationItem" (id, "runId", model, "rowId", "sourceHash", context, "destinationHash", state, reason, rules) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[]) ON CONFLICT ("runId", model, "rowId", "sourceHash") DO UPDATE SET "sourceHash" = EXCLUDED."sourceHash" RETURNING *`,
      randomUUID(),
      run.id,
      model.name,
      id,
      sourceHash,
      snapshot?.context ?? null,
      destinationHash,
      conversion.state,
      conversion.reason ?? null,
      conversion.rules,
    );
    return item;
  }

  private async discover(run: Run): Promise<void> {
    for (const model of MODELS) {
      if (run.upper[model.name] === undefined) {
        const [upper] = await rows<{ upper: number }>(
          this.database,
          `SELECT COALESCE(max(r.id), 0)::int AS upper ${from(model)} WHERE ${scopeClause(model)}`,
          run.scope.length > 0 ? run.scope : null,
        );
        run.upper[model.name] = upper.upper;
        await this.transaction((database) =>
          execute(
            database,
            'UPDATE "RichTextMigrationRun" SET upper = $2::jsonb WHERE id = $1',
            run.id,
            JSON.stringify(run.upper),
          ),
        );
      }
      let cursor = run.cursor[model.name] ?? INITIAL_CURSOR;
      while (cursor < run.upper[model.name]) {
        const page = await this.page(
          model,
          run.scope,
          cursor,
          run.upper[model.name],
        );
        if (page.length === 0) {
          cursor = run.upper[model.name];
        }
        for (const row of page) {
          const { snapshot, conversion } = await this.inspect(
            model,
            row.id,
            run.scope,
            run.origin,
            run.byteLimit,
          );
          run.cursor[model.name] = row.id;
          await this.transaction(async (database) => {
            if (conversion)
              await this.insertItem(
                database,
                run,
                model,
                row.id,
                snapshot,
                conversion,
              );
            await execute(
              database,
              'UPDATE "RichTextMigrationRun" SET cursor = $2::jsonb, "updatedAt" = clock_timestamp() WHERE id = $1',
              run.id,
              JSON.stringify(run.cursor),
            );
          });
          cursor = row.id;
        }
        if (page.length === 0) {
          run.cursor[model.name] = cursor;
          await this.transaction((database) =>
            execute(
              database,
              'UPDATE "RichTextMigrationRun" SET cursor = $2::jsonb WHERE id = $1',
              run.id,
              JSON.stringify(run.cursor),
            ),
          );
        }
        this.emit?.({
          event: "discovery-progress",
          model: model.name,
          cursor,
          upper: run.upper[model.name],
        });
      }
    }
    await this.transaction((database) =>
      execute(
        database,
        `UPDATE "RichTextMigrationItem" SET state = 'quarantined', reason = 'variant-destination-collision' WHERE "runId" = $1 AND state = 'pending' AND "destinationHash" IN (SELECT "destinationHash" FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state = 'pending' AND "destinationHash" IS NOT NULL GROUP BY "destinationHash" HAVING count(*) > 1)`,
        run.id,
      ),
    );
  }

  async apply(
    run: Run,
    maxUpdates: number,
    resumePaused = false,
  ): Promise<void> {
    if (["verified", "canary_verified", "rolled_back"].includes(run.status))
      throw new Error("run-is-terminal");
    if (run.operation !== "apply") throw new Error("run-is-rolling-back");
    if (run.status === "paused" && !resumePaused)
      throw new Error("run-is-paused");
    await this.withLease(run, async () => {
      if (run.operation !== "apply") throw new Error("run-is-rolling-back");
      if (["verified", "canary_verified", "rolled_back"].includes(run.status))
        throw new Error("run-is-terminal");
      await this.transaction(
        (database) =>
          execute(
            database,
            'UPDATE "RichTextMigrationRun" SET status = \'running\', "cleanSweeps" = 0 WHERE id = $1',
            run.id,
          ),
        resumePaused,
      );
      await this.discover(run);
      const appliedCounts = await rows<{ count: number }>(
        this.database,
        `SELECT count(*)::int AS count FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state = 'applied'`,
        run.id,
      );
      let updates = appliedCounts[0].count;
      while (!this.stopping && updates < maxUpdates) {
        const [item] = await rows<Item>(
          this.database,
          `SELECT * FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state IN ('pending', 'retryable') AND attempts < $2 AND ("retryAt" IS NULL OR "retryAt" <= clock_timestamp()) ORDER BY model, "rowId" LIMIT 1`,
          run.id,
          MAX_ATTEMPTS,
        );
        if (!item) {
          const [retry] = await rows<{ wait: number }>(
            this.database,
            `SELECT LEAST(1000, GREATEST(1, CEIL(EXTRACT(EPOCH FROM (min("retryAt") - clock_timestamp())) * 1000)))::int AS wait FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state = 'retryable' AND attempts < $2 HAVING count(*) > 0`,
            run.id,
            MAX_ATTEMPTS,
          );
          if (!retry) break;
          await delay(retry.wait);
          continue;
        }
        try {
          if (await this.applyItem(run, item)) {
            updates++;
            if (updates === 1 || updates % 100 === 0)
              this.emit?.({ event: "apply-progress", updates });
          }
        } catch (error) {
          if (
            this.lostLease ||
            this.stopping ||
            (error instanceof Error &&
              error.message === "worker-stopped-or-lease-lost")
          )
            throw error;
          const code = postgresCode(error);
          if (
            !code ||
            !["40001", "40P01", "55P03", "57014", "23505"].includes(code)
          )
            throw new Error("migration-transaction-failed");
          await this.transaction((database) =>
            execute(
              database,
              `UPDATE "RichTextMigrationItem" SET state = $2, reason = $3, attempts = attempts + 1, "retryAt" = clock_timestamp() + ($4::int * interval '1 second') WHERE id = $1 AND state IN ('pending', 'retryable')`,
              item.id,
              code === "23505" ? "quarantined" : "retryable",
              code === "23505"
                ? "variant-destination-collision"
                : `database-${code}`,
              Math.min(30, 2 ** item.attempts) + Math.floor(Math.random() * 3),
            ),
          );
        }
        await delay(100);
      }
      await this.transaction((database) =>
        execute(
          database,
          `UPDATE "RichTextMigrationRun" SET status = CASE WHEN EXISTS(SELECT 1 FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state IN ('pending', 'retryable', 'conflict', 'quarantined')) THEN 'needs_review' ELSE 'ready_to_verify' END WHERE id = $1`,
          run.id,
        ),
      );
    });
  }

  private async applyItem(run: Run, item: Item): Promise<boolean> {
    const model = modelByName(item.model);
    const { snapshot, conversion } = await this.inspect(
      model,
      item.rowId,
      run.scope,
      run.origin,
      run.byteLimit,
    );
    const applied = await this.transaction(async (database) => {
      const [current] = await rows<Item>(
        database,
        'SELECT * FROM "RichTextMigrationItem" WHERE id = $1 FOR UPDATE',
        item.id,
      );
      if (!["pending", "retryable"].includes(current.state)) return false;
      await lockSource(database, model, item.rowId);
      let actual: Snapshot | undefined;
      try {
        actual = await readSnapshot(
          database,
          model,
          item.rowId,
          run.scope,
          run.byteLimit,
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "document-size-limit"
        )
          throw error;
        await execute(
          database,
          `UPDATE "RichTextMigrationItem" SET state = 'quarantined', reason = 'document-size-limit' WHERE id = $1`,
          item.id,
        );
        return false;
      }
      let state: string | undefined;
      if (!actual) state = "deleted";
      else if (
        !snapshot ||
        actual.context !== snapshot.context ||
        model.fields.some(
          (field) => actual.values[field] !== snapshot.values[field],
        ) ||
        digest(actual) !== item.sourceHash ||
        digest(snapshot) !== item.sourceHash
      )
        state = "conflict";
      else if (conversion?.state !== "pending")
        state = conversion?.state ?? "conflict";
      if (state) {
        await execute(
          database,
          'UPDATE "RichTextMigrationItem" SET state = $2, reason = $3 WHERE id = $1',
          item.id,
          state,
          conversion?.reason ?? null,
        );
        return false;
      }
      if (!conversion) throw new Error("missing-conversion");
      const fields = Object.keys(conversion.after).filter(
        (field) => conversion.before[field] !== conversion.after[field],
      );
      const before = Object.fromEntries(
        fields.map((field) => [field, conversion.before[field]]),
      );
      const replacement = Object.fromEntries(
        fields.map((field) => [field, conversion.after[field]]),
      );
      this.fault?.("before-backup");
      await execute(
        database,
        'INSERT INTO "RichTextMigrationBackup" (id, "itemId", before, after, "beforeHash", "afterHash") VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)',
        randomUUID(),
        item.id,
        JSON.stringify(before),
        JSON.stringify(replacement),
        digest(before),
        digest(replacement),
      );
      this.fault?.("backup");
      const after = await replaceValues(
        database,
        model,
        item.rowId,
        replacement,
      );
      this.fault?.("update");
      await execute(
        database,
        'UPDATE "RichTextMigrationBackup" SET after = $2::jsonb, "afterHash" = $3 WHERE "itemId" = $1',
        item.id,
        JSON.stringify(after),
        digest(after),
      );
      await execute(
        database,
        `UPDATE "RichTextMigrationItem" SET state = 'applied', "updatedAt" = clock_timestamp(), reason = NULL WHERE id = $1`,
        item.id,
      );
      return true;
    });
    if (applied) this.fault?.("commit");
    return applied;
  }

  async pause(run: Run): Promise<void> {
    await this.database.$transaction(async (database) => {
      await rows(
        database,
        'SELECT key FROM "RichTextMigrationLease" WHERE key = $1 FOR UPDATE',
        LEASE_KEY,
      );
      await execute(
        database,
        `UPDATE "RichTextMigrationRun" SET status = 'paused' WHERE id = $1`,
        run.id,
      );
      await execute(
        database,
        'UPDATE "RichTextMigrationLease" SET owner = NULL, generation = generation + 1, "expiresAt" = clock_timestamp() WHERE key = $1 AND "runId" = $2',
        LEASE_KEY,
        run.id,
      );
    });
  }

  async resume(run: Run, maxUpdates: number): Promise<void> {
    return this.apply(run, maxUpdates, true);
  }

  stop(): void {
    this.stopping = true;
  }

  async retryConflicts(run: Run): Promise<void> {
    await this.withLease(run, async () => {
      let cursor = "";
      for (;;) {
        const [item] = await rows<Item>(
          this.database,
          `SELECT * FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state IN ('conflict', 'quarantined', 'retryable') AND id > $2 ORDER BY id LIMIT 1`,
          run.id,
          cursor,
        );
        if (!item) break;
        cursor = item.id;
        const model = modelByName(item.model);
        const { snapshot, conversion } = await this.inspect(
          model,
          item.rowId,
          run.scope,
          run.origin,
          run.byteLimit,
        );
        await this.transaction(async (database) => {
          if (!conversion) {
            await execute(
              database,
              `UPDATE "RichTextMigrationItem" SET state = 'deleted' WHERE id = $1`,
              item.id,
            );
            return;
          }
          if (
            digest(snapshot ?? { oversized: item.rowId }) === item.sourceHash
          ) {
            if (item.state === "retryable")
              await execute(
                database,
                `UPDATE "RichTextMigrationItem" SET state = 'pending', attempts = 0, "retryAt" = NULL WHERE id = $1`,
                item.id,
              );
            return;
          }
          const successor = await this.insertItem(
            database,
            run,
            model,
            item.rowId,
            snapshot,
            conversion,
          );
          if (["applied", "superseded"].includes(successor.state)) {
            await execute(
              database,
              `UPDATE "RichTextMigrationItem" SET state = 'quarantined', reason = 'source-history-repeated' WHERE id = $1`,
              item.id,
            );
            return;
          }
          await execute(
            database,
            `UPDATE "RichTextMigrationItem" SET state = 'superseded', "successorId" = $2 WHERE id = $1`,
            item.id,
            successor.id,
          );
        });
      }
    });
  }

  async status(run: Run) {
    const [current] = await rows<{ status: string }>(
      this.database,
      'SELECT status FROM "RichTextMigrationRun" WHERE id = $1',
      run.id,
    );
    const [backups] = await rows<{ count: number }>(
      this.database,
      'SELECT count(*)::int AS count FROM "RichTextMigrationBackup" b JOIN "RichTextMigrationItem" i ON i.id = b."itemId" WHERE i."runId" = $1',
      run.id,
    );
    return {
      run: run.id,
      target: run.target,
      status: current.status,
      scope: run.scope,
      items: await rows(
        this.database,
        `SELECT state, count(*)::int AS count FROM "RichTextMigrationItem" WHERE "runId" = $1 GROUP BY state ORDER BY state`,
        run.id,
      ),
      backups: backups.count,
    };
  }

  async verify(
    run: Run,
    writeBoundaryConfirmed: boolean,
    canaryApproved: boolean,
  ) {
    if (run.operation !== "apply") throw new Error("run-is-rolling-back");
    return this.withLease(run, async () => {
      if (run.operation !== "apply") throw new Error("run-is-rolling-back");
      const report = await this.audit(run.scope, run.origin, run.byteLimit);
      const fidelity = { matching: 0, changedSinceApply: 0, deleted: 0 };
      let cursor = "0";
      for (;;) {
        const [backup] = await rows<Backup>(
          this.database,
          `SELECT b.*, i.model, i."rowId" FROM "RichTextMigrationBackup" b JOIN "RichTextMigrationItem" i ON i.id = b."itemId" WHERE i."runId" = $1 AND b.sequence > $2::bigint ORDER BY b.sequence LIMIT 1`,
          run.id,
          cursor,
        );
        if (!backup) break;
        cursor = String(backup.sequence);
        if (
          digest(backup.before) !== backup.beforeHash ||
          digest(backup.after) !== backup.afterHash
        )
          throw new Error("backup-integrity-failed");
        let current: Snapshot | undefined;
        try {
          current = await readSnapshot(
            this.database,
            modelByName(backup.model),
            backup.rowId,
            run.scope,
            run.byteLimit,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "document-size-limit"
          ) {
            fidelity.changedSinceApply++;
            continue;
          }
          throw error;
        }
        if (!current) fidelity.deleted++;
        else if (
          Object.keys(backup.after).some(
            (field) => current.values[field] !== backup.after[field],
          )
        )
          fidelity.changedSinceApply++;
        else fidelity.matching++;
      }
      const [remaining] = await rows<{ count: number }>(
        this.database,
        `SELECT count(*)::int AS count FROM "RichTextMigrationItem" WHERE "runId" = $1 AND state IN ('pending', 'retryable', 'conflict', 'quarantined')`,
        run.id,
      );
      const clean =
        report.pending === 0 &&
        report.quarantined === 0 &&
        remaining.count === 0;
      const status =
        clean &&
        writeBoundaryConfirmed &&
        canaryApproved &&
        run.cleanSweeps >= 1
          ? run.scope.length > 0
            ? "canary_verified"
            : "verified"
          : clean
            ? "ready_to_verify"
            : "needs_review";
      await this.transaction((database) =>
        execute(
          database,
          'UPDATE "RichTextMigrationRun" SET "cleanSweeps" = $2, status = $3 WHERE id = $1',
          run.id,
          clean && writeBoundaryConfirmed && canaryApproved
            ? run.cleanSweeps + 1
            : 0,
          status,
        ),
      );
      return {
        ...report,
        fidelity,
        clean,
        status,
        retirementReady: status === "verified",
      };
    });
  }

  async rollback(run: Run): Promise<void> {
    if (run.status === "rolled_back") return;
    await this.withLease(run, async () => {
      await this.transaction(
        (database) =>
          execute(
            database,
            `UPDATE "RichTextMigrationRun" SET operation = 'rollback', status = 'rolling_back', "cleanSweeps" = 0 WHERE id = $1`,
            run.id,
          ),
        true,
      );
      let cursor: string | null = null;
      while (!this.stopping) {
        const backups: Backup[] = await rows<Backup>(
          this.database,
          `SELECT b.*, i.model, i."rowId" FROM "RichTextMigrationBackup" b JOIN "RichTextMigrationItem" i ON i.id = b."itemId" WHERE i."runId" = $1 AND b."rollbackState" != 'restored' AND ($2::bigint IS NULL OR b.sequence < $2::bigint) ORDER BY b.sequence DESC LIMIT 1`,
          run.id,
          cursor,
        );
        const [backup] = backups;
        if (!backup) break;
        cursor = String(backup.sequence);
        if (
          digest(backup.before) !== backup.beforeHash ||
          digest(backup.after) !== backup.afterHash
        )
          throw new Error("backup-integrity-failed");
        try {
          await this.transaction(async (database) => {
            const model = modelByName(backup.model);
            await lockSource(database, model, backup.rowId);
            let current: Snapshot | undefined;
            let oversized = false;
            try {
              current = await readSnapshot(
                database,
                model,
                backup.rowId,
                run.scope,
                run.byteLimit,
              );
            } catch (error) {
              if (
                error instanceof Error &&
                error.message === "document-size-limit"
              )
                oversized = true;
              else throw error;
            }
            const state = oversized
              ? "conflict"
              : current
                ? Object.keys(backup.after).some(
                    (field) => current.values[field] !== backup.after[field],
                  )
                  ? "conflict"
                  : "restored"
                : "deleted";
            if (state === "restored") {
              try {
                await replaceValues(
                  database,
                  model,
                  backup.rowId,
                  backup.before,
                );
              } catch (error) {
                if (postgresCode(error) === "23505") throw error;
                throw new Error("rollback-verification-failed");
              }
            }
            await execute(
              database,
              'UPDATE "RichTextMigrationBackup" SET "rollbackState" = $2, "rolledBackAt" = CASE WHEN $2 = \'restored\' THEN clock_timestamp() ELSE NULL END WHERE id = $1',
              backup.id,
              state,
            );
          });
        } catch (error) {
          if (postgresCode(error) !== "23505") throw error;
          await this.transaction((database) =>
            execute(
              database,
              `UPDATE "RichTextMigrationBackup" SET "rollbackState" = 'quarantined' WHERE id = $1`,
              backup.id,
            ),
          );
        }
        await delay(100);
      }
      await this.transaction((database) =>
        execute(
          database,
          `UPDATE "RichTextMigrationRun" SET status = CASE WHEN EXISTS(SELECT 1 FROM "RichTextMigrationBackup" b JOIN "RichTextMigrationItem" i ON i.id = b."itemId" WHERE i."runId" = $1 AND b."rollbackState" NOT IN ('restored', 'deleted')) THEN 'needs_review' ELSE 'rolled_back' END WHERE id = $1`,
          run.id,
        ),
      );
    });
  }
}

function postgresCode(error: unknown): string | undefined {
  const exception = error as { code?: string; meta?: { code?: string } };
  return (
    exception.meta?.code ??
    (/^[\dA-Z]{5}$/.test(exception.code ?? "") ? exception.code : undefined)
  );
}
