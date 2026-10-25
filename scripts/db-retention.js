#!/usr/bin/env node
/**
 * Delete grading byproduct that nothing reads back, in bounded batches.
 *
 * What it removes, and why each window is safe:
 *   GradingCache   rows older than --cache-days (30). A cache: a miss costs
 *                  one model call. The in-memory and Redis layers are
 *                  unaffected.
 *   GradingAudit   rows older than --audit-days (60). Grade reuse looks back
 *                  7 days per question; everything beyond that is forensic
 *                  detail. The grade and feedback stay on QuestionResponse.
 *   LtiGradeSync   authCookie blanked once a row is older than --cookie-days
 *                  (7). A session cookie lives 6 hours, so an older one is
 *                  dead weight that still carries a learner token. Rows
 *                  older than --lti-sync-days (365) are deleted outright;
 *                  the grade itself lives on AssignmentAttempt.
 *   operation        finished rows older than --operation-days (30), with
 *                    their progress events (cascade). Nothing reads a
 *                    finished operation once its result is written.
 *   operation_outbox sent rows, and dead rows last touched, older than
 *                    --operation-days. In-flight rows are never touched.
 *
 * Never touches attempts, responses or grades.
 *
 * USAGE (always start with --dry-run):
 *
 *   node db-retention.js --dry-run      count what each step would touch
 *   node db-retention.js --execute      run the sweeps
 *
 * FLAGS:
 *   --cache-days=30  --audit-days=60  --cookie-days=7  --lti-sync-days=365
 *   --operation-days=30
 *   --batch-size=5000      rows per statement
 *   --max-seconds=1500     stop (exit 0) once this much time has passed; the
 *                          next run continues. 0 = no limit.
 *   --pause-ms=200         wait between batches so autovacuum and replication
 *                          keep up
 *
 * Reads DATABASE_URL like the running pod. Each batch is one short
 * transaction with a local statement timeout, which is the only safe shape
 * behind pgbouncer in transaction mode (nothing session-level is ever set).
 * Deleted space is reused by Postgres for new rows; it is not returned to
 * the OS unless the table is rewritten.
 */

// Lower bounds that keep the product working. Grade reuse reads GradingAudit
// for the last 7 days (grading-consistency.service.ts); session cookies
// expire after 6 hours.
const MIN_DAYS = {
  cacheDays: 7,
  auditDays: 7,
  cookieDays: 1,
  ltiSyncDays: 30,
  operationDays: 7,
};

const DEFAULTS = {
  dryRun: true,
  cacheDays: 30,
  auditDays: 60,
  cookieDays: 7,
  ltiSyncDays: 365,
  operationDays: 30,
  batchSize: 5000,
  maxSeconds: 1500,
  pauseMs: 200,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Set by the kubelet in every k8s pod; gates the linkerd-proxy handshakes
// below so local/manual runs skip them entirely.
const IN_CLUSTER = Boolean(process.env.KUBERNETES_SERVICE_HOST);

function fail(message) {
  console.error(message);
  process.exit(2);
}

function numberFlag(arg, name) {
  const value = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(value) || value < 0) fail(`Invalid value for --${name}`);
  return value;
}

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  const numeric = {
    "cache-days": "cacheDays",
    "audit-days": "auditDays",
    "cookie-days": "cookieDays",
    "lti-sync-days": "ltiSyncDays",
    "operation-days": "operationDays",
    "batch-size": "batchSize",
    "max-seconds": "maxSeconds",
    "pause-ms": "pauseMs",
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--execute") {
      args.dryRun = false;
      continue;
    }
    const name = Object.keys(numeric).find((flag) =>
      arg.startsWith(`--${flag}=`),
    );
    if (!name) fail(`Unknown flag: ${arg}`);
    args[numeric[name]] = numberFlag(arg, name);
  }
  for (const [key, min] of Object.entries(MIN_DAYS)) {
    if (args[key] < min) {
      fail(`--${key} must be at least ${min} days (got ${args[key]})`);
    }
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize < 1) {
    fail("--batch-size must be a positive integer");
  }
  return args;
}

function cutoffFor(days, now) {
  return new Date(now.getTime() - days * DAY_MS);
}

// Every statement is bounded by LIMIT so a single batch can never run long
// enough to hold locks or bloat the WAL, and SKIP LOCKED keeps a batch from
// waiting on a row the application is updating at that moment (the next
// run picks such rows up). Each select orders by the indexed age column so
// the planner takes that index rather than scanning the table for the
// first matches.
function buildSteps(args, now, sql) {
  return [
    {
      name: "lti_sync_cookies",
      cutoff: cutoffFor(args.cookieDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "LtiGradeSync" WHERE "updatedAt" < ${cutoff} AND "authCookie" <> ''`,
      apply: (cutoff, limit) =>
        sql`UPDATE "LtiGradeSync" SET "authCookie" = '' WHERE id IN (SELECT id FROM "LtiGradeSync" WHERE "updatedAt" < ${cutoff} AND "authCookie" <> '' ORDER BY "updatedAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    {
      name: "grading_cache",
      cutoff: cutoffFor(args.cacheDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "GradingCache" WHERE "cachedAt" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "GradingCache" WHERE id IN (SELECT id FROM "GradingCache" WHERE "cachedAt" < ${cutoff} ORDER BY "cachedAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    {
      name: "grading_audit",
      cutoff: cutoffFor(args.auditDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "GradingAudit" WHERE "timestamp" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "GradingAudit" WHERE id IN (SELECT id FROM "GradingAudit" WHERE "timestamp" < ${cutoff} ORDER BY "timestamp" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    {
      name: "lti_sync_rows",
      cutoff: cutoffFor(args.ltiSyncDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "LtiGradeSync" WHERE "updatedAt" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "LtiGradeSync" WHERE id IN (SELECT id FROM "LtiGradeSync" WHERE "updatedAt" < ${cutoff} ORDER BY "updatedAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    // optionalTable: skipped, not failed, on a database that predates the
    // operation tables. Outbox first: deleting an operation would otherwise
    // SET NULL on outbox rows about to go anyway.
    {
      name: "operation_outbox",
      optionalTable: true,
      cutoff: cutoffFor(args.operationDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "operation_outbox" WHERE "sent_at" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "operation_outbox" WHERE id IN (SELECT id FROM "operation_outbox" WHERE "sent_at" < ${cutoff} ORDER BY "sent_at" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    // Dead rows have no sent_at; there are few, so no index on updated_at.
    {
      name: "operation_outbox_dead",
      optionalTable: true,
      cutoff: cutoffFor(args.operationDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "operation_outbox" WHERE "updated_at" < ${cutoff} AND "state" = 'dead'`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "operation_outbox" WHERE id IN (SELECT id FROM "operation_outbox" WHERE "updated_at" < ${cutoff} AND "state" = 'dead' ORDER BY "updated_at" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
    {
      name: "operations",
      optionalTable: true,
      cutoff: cutoffFor(args.operationDays, now),
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "operation" WHERE "finished_at" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "operation" WHERE id IN (SELECT id FROM "operation" WHERE "finished_at" < ${cutoff} ORDER BY "finished_at" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
    },
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// One short transaction per statement: SET LOCAL ends with the transaction,
// so nothing leaks onto the pooled server connection. The Prisma-side
// timeout must outlast the statement timeout, or Prisma closes the
// transaction underneath a slow batch (P2028).
async function inTransaction(prisma, timeoutSeconds, run) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${timeoutSeconds}s'`,
      );
      return run(tx);
    },
    { maxWait: 10_000, timeout: (timeoutSeconds + 30) * 1000 },
  );
}

async function runStep(prisma, step, args, deadline) {
  let total = 0;
  let batches = 0;
  for (;;) {
    if (deadline && Date.now() >= deadline) {
      return { total, batches, exhausted: true };
    }
    const batchStart = Date.now();
    const rows = await inTransaction(prisma, 60, (tx) =>
      tx.$executeRaw(step.apply(step.cutoff, args.batchSize)),
    );
    total += rows;
    batches += 1;
    console.log(
      `${step.name}: batch ${batches} touched ${rows} rows in ${Date.now() - batchStart}ms (total ${total})`,
    );
    if (rows < args.batchSize) return { total, batches, exhausted: false };
    await sleep(args.pauseMs);
  }
}

// Postgres undefined_table, surfaced by Prisma raw queries as P2010 with the
// SQLSTATE in meta.code.
function isUndefinedTable(error) {
  return (
    Boolean(error) &&
    (error.code === "42P01" ||
      (error.meta !== undefined && error.meta.code === "42P01"))
  );
}

// Runs one step; a missing table is tolerated only on optionalTable steps,
// so any other failure still fails the run.
async function runOne(prisma, step, args, deadline) {
  try {
    if (args.dryRun) {
      const [{ n }] = await inTransaction(prisma, 120, (tx) =>
        tx.$queryRaw(step.count(step.cutoff)),
      );
      console.log(
        `${step.name}: ${n} rows older than ${step.cutoff.toISOString()}`,
      );
      return { skipped: false, exhausted: false };
    }
    const result = await runStep(prisma, step, args, deadline);
    console.log(
      `${step.name}: done, ${result.total} rows in ${result.batches} batches` +
        (result.exhausted ? " (time budget exhausted, resumes next run)" : ""),
    );
    return { skipped: false, exhausted: result.exhausted };
  } catch (error) {
    if (step.optionalTable && isUndefinedTable(error)) {
      console.warn(`operations tables not present yet; skipping ${step.name}`);
      return { skipped: true, exhausted: false };
    }
    throw error;
  }
}

async function runSteps(prisma, steps, args, deadline) {
  const skipped = [];
  for (const step of steps) {
    const result = await runOne(prisma, step, args, deadline);
    if (result.skipped) skipped.push(step.name);
    if (result.exhausted) return { exhausted: true, skipped };
  }
  return { exhausted: false, skipped };
}

async function main() {
  const args = parseArgs(process.argv);
  // Required lazily so the exported helpers can be unit-tested without a
  // generated client or a database.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient, Prisma } = require("@prisma/client");
  const prisma = new PrismaClient();
  const now = new Date();
  const steps = buildSteps(args, now, Prisma.sql);
  const start = Date.now();
  const deadline = args.maxSeconds > 0 ? start + args.maxSeconds * 1000 : 0;

  console.log(
    `db-retention ${args.dryRun ? "DRY RUN" : "EXECUTE"} at ${now.toISOString()} ` +
      `(cache ${args.cacheDays}d, audit ${args.auditDays}d, cookies ${args.cookieDays}d, ` +
      `lti rows ${args.ltiSyncDays}d, operations ${args.operationDays}d, batch ${args.batchSize})`,
  );

  await awaitLinkerdProxy();
  let summary;
  try {
    summary = await runSteps(prisma, steps, args, deadline);
  } finally {
    await prisma.$disconnect();
  }
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `db-retention finished in ${elapsedSec}s` +
      (summary.skipped.length > 0
        ? ` (skipped: ${summary.skipped.join(", ")})`
        : "") +
      (summary.exhausted ? " with work remaining" : ""),
  );
}

// The kubelet does not wait for the injected linkerd-proxy to be ready
// before starting this container, and outbound traffic is already
// iptables-redirected to the proxy port. Wait for the proxy before doing
// any work; proceed after the deadline so a missing sidecar can't block a
// run forever.
async function awaitLinkerdProxy() {
  if (!IN_CLUSTER) return;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://localhost:4191/ready", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return;
    } catch {
      // proxy not listening yet
    }
    await sleep(1000);
  }
  console.warn("linkerd-proxy not ready after 120s; proceeding without it");
}

// The linkerd-proxy sidecar does not exit when the main container does, so
// without this POST the Job stays active and concurrencyPolicy: Forbid
// skips every later tick. In-cluster the POST retries until the deadline
// in case the proxy was still starting when this process ended.
async function shutdownLinkerdProxy() {
  const deadline = Date.now() + (IN_CLUSTER ? 120_000 : 0);
  for (;;) {
    try {
      await fetch("http://localhost:4191/shutdown", {
        method: "POST",
        signal: AbortSignal.timeout(2000),
      });
      return;
    } catch {
      if (Date.now() >= deadline) return; // no sidecar, or already shut down
      await sleep(2000);
    }
  }
}

if (require.main === module) {
  main()
    .then(shutdownLinkerdProxy)
    .catch(async (error) => {
      console.error(error);
      await shutdownLinkerdProxy();
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  cutoffFor,
  buildSteps,
  runSteps,
  isUndefinedTable,
  DEFAULTS,
  MIN_DAYS,
};
