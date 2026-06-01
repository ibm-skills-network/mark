#!/usr/bin/env node
/**
 * Drain stuck LtiGradeSync rows by triggering the admin manual-retry endpoint.
 *
 * USAGE (always start with --dry-run):
 *
 *   API_BASE=https://<internal-api-host> \
 *     node lti-sync-drain.js --dry-run
 *
 *   API_BASE=https://<internal-api-host> \
 *     node lti-sync-drain.js --execute
 *
 * FLAGS:
 *   --dry-run               (default) list what would be retried, hit nothing
 *   --execute               actually POST /admin/lti-sync/retry/:syncId
 *   --since=2026-05-25T18:31:00Z
 *                           only sync rows createdAt >= this ISO timestamp
 *                           (default: 2026-05-25T18:31:00Z — the recent batch)
 *   --all                   ignore --since, include every SCHEDULED row
 *   --include-failed        also pick up FAILED rows (default: SCHEDULED only)
 *   --rate=5                requests per second (default 5)
 *   --limit=N               cap total rows processed (default: no cap)
 *   --batch-size=500        DB page size (default 500)
 *
 * AUTH (only if you've put a guard on /admin/lti-sync/*):
 *   ADMIN_TOKEN=...   sets Authorization: Bearer <token>
 *   AUTH_COOKIE=...   sets Cookie: authentication=<value>
 *
 * Reads the same DATABASE_URL as the running pod (so run it from a pod or with
 * a port-forward). Writes only via the API endpoint, never directly to the DB.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function parseArgs(argv) {
  const args = {
    dryRun: true,
    since: "2026-05-25T18:31:00Z",
    all: false,
    includeFailed: false,
    ignoreNextRetry: false,
    concurrency: 1,
    limit: Number.POSITIVE_INFINITY,
    batchSize: 500,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--execute") args.dryRun = false;
    else if (arg === "--all") args.all = true;
    else if (arg === "--include-failed") args.includeFailed = true;
    else if (arg === "--ignore-next-retry") args.ignoreNextRetry = true;
    else if (arg.startsWith("--since=")) args.since = arg.slice(8);
    else if (arg.startsWith("--concurrency="))
      args.concurrency = Number(arg.slice(14));
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice(8));
    else if (arg.startsWith("--batch-size="))
      args.batchSize = Number(arg.slice(13));
    else if (arg.startsWith("--rate=")) {
      // accepted for back-compat, ignored — throughput is controlled by --concurrency
    } else {
      console.error(`Unknown flag: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryOne(apiBase, syncId, headers) {
  const url = `${apiBase}/admin/lti-sync/retry/${syncId}`;
  const response = await fetch(url, { method: "POST", headers });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { raw: await response.text().catch(() => "") };
  }
  return { status: response.status, body };
}

async function fetchPage(args, cursorId) {
  const statuses = args.includeFailed ? ["SCHEDULED", "FAILED"] : ["SCHEDULED"];
  const where = { status: { in: statuses } };
  if (!args.all) where.createdAt = { gte: new Date(args.since) };
  if (cursorId != null) where.id = { gt: cursorId };
  if (!args.ignoreNextRetry) {
    // Match the in-process cron's behaviour: only process rows whose
    // backoff has elapsed. nextRetryAt may be null on a fresh row that
    // has never been scheduled (first immediate-sync failure) — treat
    // those as due too.
    where.OR = [{ nextRetryAt: { lte: new Date() } }, { nextRetryAt: null }];
  }

  return prisma.ltiGradeSync.findMany({
    where,
    select: { id: true, attemptId: true, status: true, createdAt: true },
    orderBy: { id: "asc" },
    take: args.batchSize,
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const apiBase = process.env.API_BASE;
  if (!args.dryRun && !apiBase) {
    console.error("API_BASE env var is required for --execute mode");
    process.exit(2);
  }

  const headers = { "content-type": "application/json" };
  if (process.env.ADMIN_TOKEN) {
    headers["authorization"] = `Bearer ${process.env.ADMIN_TOKEN}`;
  }
  if (process.env.AUTH_COOKIE) {
    headers["cookie"] = `authentication=${process.env.AUTH_COOKIE}`;
  }

  console.log("LTI sync drain");
  console.log("  mode       :", args.dryRun ? "DRY RUN" : "EXECUTE");
  console.log("  api base   :", apiBase || "(none — dry run)");
  console.log(
    "  scope      :",
    args.all ? "ALL SCHEDULED" : `createdAt >= ${args.since}`,
  );
  console.log(
    "  statuses   :",
    args.includeFailed ? "SCHEDULED + FAILED" : "SCHEDULED",
  );
  console.log("  concurrency:", args.concurrency);
  console.log(
    "  limit      :",
    args.limit === Number.POSITIVE_INFINITY ? "none" : args.limit,
  );
  console.log("  batch size :", args.batchSize);
  console.log("");

  const counts = { success: 0, retried: 0, failed: 0, alreadyOk: 0 };
  let processed = 0;
  let cursorId = null;
  const start = Date.now();
  let lastReportAt = Date.now();

  async function processRow(row) {
    if (args.dryRun) return;
    try {
      const { status, body } = await retryOne(apiBase, row.id, headers);
      if (status >= 200 && status < 300) {
        const syncStatus = body && body.status;
        const message = body && body.message;
        if (syncStatus === "SUCCESS") {
          counts.success += 1;
          if (message && /already/i.test(message)) counts.alreadyOk += 1;
        } else {
          counts.retried += 1;
        }
      } else {
        counts.failed += 1;
        if (counts.failed <= 5 || counts.failed % 50 === 0) {
          console.warn(`sync ${row.id} → HTTP ${status}`, body);
        }
      }
    } catch (error) {
      counts.failed += 1;
      if (counts.failed <= 5 || counts.failed % 50 === 0) {
        console.warn(
          `sync ${row.id} → fetch error:`,
          error && error.message ? error.message : error,
        );
      }
    }
  }

  // Worker-pool pattern: N workers each pull rows independently from a
  // shared in-memory queue. The producer refills the queue from DB in
  // batches. Slow outliers don't block other workers.
  const queue = [];
  let done = false;
  let lastFetchedId = null;
  // Single-flight guard so N workers seeing an empty queue can't all
  // fetch overlapping pages from the same cursor (which would inflate
  // the queue with duplicates and waste manualRetry calls on rows that
  // have already been flipped to SUCCESS).
  let refillInFlight = null;

  async function refillQueue() {
    if (done) return;
    if (refillInFlight) {
      await refillInFlight;
      return;
    }
    refillInFlight = (async () => {
      try {
        const remaining = args.limit - processed - queue.length;
        if (remaining <= 0) return;
        const rows = await fetchPage(args, lastFetchedId);
        if (rows.length === 0) {
          done = true;
          return;
        }
        lastFetchedId = rows[rows.length - 1].id;
        for (const row of rows) queue.push(row);
      } finally {
        refillInFlight = null;
      }
    })();
    await refillInFlight;
  }

  async function worker(id) {
    while (true) {
      if (queue.length === 0) {
        if (done) return;
        await refillQueue();
        if (queue.length === 0) return;
      }
      if (processed >= args.limit) return;
      const row = queue.shift();
      if (!row) return;
      processed += 1;
      cursorId = row.id;

      if (args.dryRun) {
        if (processed <= 10 || processed % 500 === 0) {
          console.log(
            `[dry] would retry sync ${row.id} (attempt ${row.attemptId}, ${row.status}, ${row.createdAt.toISOString()})`,
          );
        }
      } else {
        await processRow(row);
      }

      const now = Date.now();
      if (now - lastReportAt >= 5000) {
        const elapsed = (now - start) / 1000;
        const rate = processed / elapsed;
        console.log(
          `[${processed}] elapsed=${elapsed.toFixed(0)}s rate=${rate.toFixed(1)}/s SUCCESS=${counts.success} retried=${counts.retried} failed=${counts.failed} queue=${queue.length}`,
        );
        lastReportAt = now;
      }
    }
  }

  try {
    await refillQueue();
    const workers = Array.from({ length: args.concurrency }, (_, i) =>
      worker(i),
    );
    await Promise.all(workers);
  } finally {
    await prisma.$disconnect();
  }

  const elapsedSec = ((Date.now() - start) / 1000).toFixed(1);
  console.log("");
  console.log("── Done ──");
  console.log("  processed   :", processed);
  if (!args.dryRun) {
    console.log(
      "  SUCCESS now :",
      counts.success,
      `(of which ${counts.alreadyOk} were already SUCCESS before retry)`,
    );
    console.log("  retried/sched:", counts.retried);
    console.log("  failed      :", counts.failed);
  }
  console.log("  elapsed     :", `${elapsedSec}s`);
}

// When running inside a Linkerd-meshed K8s pod (e.g. our CronJob), the
// linkerd-proxy sidecar does NOT exit when the main container does, so
// the Job stays in "Running" forever and the CronJob's concurrencyPolicy:
// Forbid would skip every subsequent tick. POSTing to the proxy admin
// endpoint tells it to shut down cleanly. Best-effort: failures are
// ignored (e.g. when running locally without a sidecar).
async function shutdownLinkerdProxy() {
  try {
    await fetch("http://localhost:4191/shutdown", {
      method: "POST",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // no sidecar, or already shut down — fine
  }
}

main()
  .then(shutdownLinkerdProxy)
  .catch(async (error) => {
    console.error(error);
    await shutdownLinkerdProxy();
    process.exit(1);
  });
