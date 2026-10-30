#!/usr/bin/env node
/**
 * Delete byproduct that nothing reads back, in bounded batches.
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
 *   Chat           rows idle longer than --chat-days (30), with their messages
 *                  (FK cascade). Chats are private to the learner and a
 *                  conversation only continues on the day it started.
 *   chatbot/ files objects under the chatbot/ prefix of the learner bucket
 *                  older than --chat-file-days (30). Retired attachments that
 *                  nothing reads. The same bucket holds graded answer uploads,
 *                  so no other key is ever touched.
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
 *   --chat-days=30  --chat-file-days=30
 *   --batch-size=5000      rows per statement
 *   --max-seconds=1500     stop (exit 0) once this much time has passed; the
 *                          next run continues. 0 = no limit.
 *   --pause-ms=200         wait between batches so autovacuum and replication
 *                          keep up
 *
 * Reads DATABASE_URL and the IBM_COS_* variables like the running pod; without
 * IBM_COS_LEARNER_BUCKET and IBM_COS_ENDPOINT the file sweep is skipped. Each batch is one short
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
  chatDays: 1,
  chatFileDays: 1,
};

const DEFAULTS = {
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
};

const DAY_MS = 24 * 60 * 60 * 1000;

// A deleted chat takes all its messages with it, so a full-size batch could
// outlast the statement timeout.
const CHAT_MAX_BATCH = 500;

// The trailing slash matters: it is the only thing separating these objects
// from the graded answer uploads in the same bucket.
const CHAT_FILE_PREFIX = "chatbot/";
const CHAT_FILE_DELETE_CONCURRENCY = 20;

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
    "chat-days": "chatDays",
    "chat-file-days": "chatFileDays",
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
    {
      name: "chats",
      cutoff: cutoffFor(args.chatDays, now),
      maxBatch: CHAT_MAX_BATCH,
      count: (cutoff) =>
        sql`SELECT count(*)::int AS n FROM "Chat" WHERE "lastActiveAt" < ${cutoff}`,
      apply: (cutoff, limit) =>
        sql`DELETE FROM "Chat" WHERE id IN (SELECT id FROM "Chat" WHERE "lastActiveAt" < ${cutoff} ORDER BY "lastActiveAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED)`,
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
  const limit = Math.min(args.batchSize, step.maxBatch ?? args.batchSize);
  let total = 0;
  let batches = 0;
  for (;;) {
    if (deadline && Date.now() >= deadline) {
      return { total, batches, exhausted: true };
    }
    const batchStart = Date.now();
    const rows = await inTransaction(prisma, 60, (tx) =>
      tx.$executeRaw(step.apply(step.cutoff, limit)),
    );
    total += rows;
    batches += 1;
    console.log(
      `${step.name}: batch ${batches} touched ${rows} rows in ${Date.now() - batchStart}ms (total ${total})`,
    );
    if (rows < limit) return { total, batches, exhausted: false };
    await sleep(args.pauseMs);
  }
}

// Same client settings as the API's S3Service. Only the bucket's list and
// single-object delete are used.
function createChatFileStore(env) {
  const bucket = env.IBM_COS_LEARNER_BUCKET;
  if (!bucket || !env.IBM_COS_ENDPOINT) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sdk = require("@aws-sdk/client-s3");
  const client = new sdk.S3Client({
    endpoint: env.IBM_COS_ENDPOINT,
    credentials: {
      accessKeyId: env.IBM_COS_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.IBM_COS_SECRET_ACCESS_KEY ?? "",
    },
    forcePathStyle: true,
    region: env.IBM_COS_REGION ?? "us-east",
  });
  return {
    list: async (prefix, token) => {
      const page = await client.send(
        new sdk.ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      return {
        files: page.Contents ?? [],
        nextToken: page.NextContinuationToken,
      };
    },
    remove: async (key) => {
      await client.send(
        new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    },
  };
}

// Keys hold the learner's email, so failures log the error name and never the
// key. The key check repeats the listing's prefix on purpose: this bucket also
// holds graded answers, and a wrong listing must not be able to delete one.
async function sweepChatFiles(store, { cutoff, dryRun, deadline }) {
  const result = { matched: 0, deleted: 0, failed: 0, exhausted: false };
  let token;
  do {
    if (deadline && Date.now() >= deadline) {
      result.exhausted = true;
      return result;
    }
    const page = await store.list(CHAT_FILE_PREFIX, token);
    const expired = page.files
      .filter(
        (file) =>
          file.Key.startsWith(CHAT_FILE_PREFIX) && file.LastModified < cutoff,
      )
      .map((file) => file.Key);
    result.matched += expired.length;
    if (!dryRun) {
      for (
        let start = 0;
        start < expired.length;
        start += CHAT_FILE_DELETE_CONCURRENCY
      ) {
        const chunk = expired.slice(
          start,
          start + CHAT_FILE_DELETE_CONCURRENCY,
        );
        const outcomes = await Promise.allSettled(
          chunk.map((key) => store.remove(key)),
        );
        for (const outcome of outcomes) {
          if (outcome.status === "fulfilled") {
            result.deleted += 1;
            continue;
          }
          if (result.failed === 0) {
            console.error(
              `chatbot_files: delete failed (${outcome.reason?.name ?? "unknown error"}); later failures are only counted`,
            );
          }
          result.failed += 1;
        }
      }
    }
    token = page.nextToken;
  } while (token);
  return result;
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
      `lti rows ${args.ltiSyncDays}d, chats ${args.chatDays}d, ` +
      `chat files ${args.chatFileDays}d, batch ${args.batchSize})`,
  );

  await awaitLinkerdProxy();
  let exhausted = false;
  try {
    for (const step of steps) {
      if (args.dryRun) {
        const [{ n }] = await inTransaction(prisma, 120, (tx) =>
          tx.$queryRaw(step.count(step.cutoff)),
        );
        console.log(
          `${step.name}: ${n} rows older than ${step.cutoff.toISOString()}`,
        );
        continue;
      }
      const result = await runStep(prisma, step, args, deadline);
      console.log(
        `${step.name}: done, ${result.total} rows in ${result.batches} batches` +
          (result.exhausted
            ? " (time budget exhausted, resumes next run)"
            : ""),
      );
      if (result.exhausted) {
        exhausted = true;
        break;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  let failedFiles = 0;
  if (!exhausted) {
    const store = createChatFileStore(process.env);
    if (store) {
      const cutoff = cutoffFor(args.chatFileDays, now);
      const files = await sweepChatFiles(store, {
        cutoff,
        dryRun: args.dryRun,
        deadline,
      });
      failedFiles = files.failed;
      exhausted = files.exhausted;
      console.log(
        `chatbot_files: ${files.matched} objects older than ${cutoff.toISOString()}, ` +
          `${files.deleted} deleted, ${files.failed} failed` +
          (files.exhausted ? " (time budget exhausted, resumes next run)" : ""),
      );
    } else {
      console.warn("chatbot_files: skipped, object storage is not configured");
    }
  }
  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `db-retention finished in ${elapsedSec}s${exhausted ? " with work remaining" : ""}`,
  );
  // Fail the Job so denied deletes surface instead of recurring unnoticed.
  if (failedFiles > 0) {
    throw new Error(`chatbot_files: ${failedFiles} deletes failed`);
  }
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
  runStep,
  sweepChatFiles,
  createChatFileStore,
  DEFAULTS,
  MIN_DAYS,
};
