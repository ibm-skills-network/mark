#!/usr/bin/env node
/**
 * Read-only diagnostic for the LTI grade sync pipeline.
 *
 * Usage (inside a mark-api pod where @prisma/client is already installed):
 *   node lti-sync-diagnose.js
 *
 * What it reports:
 *   1. Status distribution across the whole LtiGradeSync table
 *   2. Last-24h breakdown by status
 *   3. Overdue SCHEDULED rows (nextRetryAt < now) — the smoking gun if cron is dead
 *   4. Last 30 LtiSyncErrorLog entries — what the gateway is actually responding
 *   5. Hourly trend of created syncs by status
 *
 * Performs zero writes. Safe against prod.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function printTable(title, rows) {
  console.log(`\n── ${title} ──`);
  if (rows.length === 0) {
    console.log("(no rows)");
    return;
  }
  console.table(rows);
}

async function statusDistribution() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*)::int AS count
    FROM "LtiGradeSync"
    GROUP BY status
    ORDER BY count DESC;
  `);
  printTable("1. Status distribution (all-time)", rows);
}

async function last24hBreakdown() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT status,
           COUNT(*)::int AS count,
           MIN("createdAt") AS earliest,
           MAX("createdAt") AS latest
    FROM "LtiGradeSync"
    WHERE "createdAt" > now() - interval '24 hours'
    GROUP BY status
    ORDER BY count DESC;
  `);
  printTable("2. Last 24h breakdown by status", rows);
}

async function overdueScheduled() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT id,
           "attemptId",
           "assignmentId",
           "retryCount",
           LEFT(COALESCE("lastError", ''), 120) AS last_error,
           "nextRetryAt",
           "createdAt",
           EXTRACT(EPOCH FROM (now() - "nextRetryAt"))::int AS overdue_seconds
    FROM "LtiGradeSync"
    WHERE status = 'SCHEDULED'
      AND "nextRetryAt" < now()
    ORDER BY "nextRetryAt" ASC
    LIMIT 20;
  `);
  printTable(
    "3. Overdue SCHEDULED rows (nextRetryAt < now) — top 20 oldest",
    rows,
  );

  const countResult = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS count
    FROM "LtiGradeSync"
    WHERE status = 'SCHEDULED' AND "nextRetryAt" < now();
  `);
  console.log(
    `   Total overdue SCHEDULED rows: ${countResult[0] ? countResult[0].count : 0}`,
  );
}

async function recentErrors() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT e."syncId",
           s."attemptId",
           e."attemptNumber",
           e."httpStatus",
           LEFT(COALESCE(e."errorMessage", ''), 200) AS error_excerpt,
           LEFT(COALESCE(e."responseBody", ''), 200) AS response_excerpt,
           e."timestamp"
    FROM "LtiSyncErrorLog" e
    JOIN "LtiGradeSync" s ON s.id = e."syncId"
    WHERE e."timestamp" > now() - interval '24 hours'
    ORDER BY e."timestamp" DESC
    LIMIT 30;
  `);
  printTable("4. Last 30 error log entries (last 24h)", rows);

  const byStatus = await prisma.$queryRawUnsafe(`
    SELECT COALESCE("httpStatus"::text, 'null') AS http_status,
           COUNT(*)::int AS count
    FROM "LtiSyncErrorLog"
    WHERE "timestamp" > now() - interval '24 hours'
    GROUP BY 1
    ORDER BY count DESC;
  `);
  printTable("   HTTP status code histogram (last 24h)", byStatus);
}

async function hourlyTrend() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT date_trunc('hour', "createdAt") AS hour,
           status,
           COUNT(*)::int AS count
    FROM "LtiGradeSync"
    WHERE "createdAt" > now() - interval '24 hours'
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2;
  `);
  printTable("5. Hourly sync creation by status (last 24h)", rows);
}

async function main() {
  console.log(`LTI grade sync diagnostic — ${new Date().toISOString()}`);
  console.log(
    "Read-only. No rows will be modified. Safe to run against production.",
  );

  try {
    await statusDistribution();
    await last24hBreakdown();
    await overdueScheduled();
    await recentErrors();
    await hourlyTrend();
  } catch (error) {
    console.error("\n[diagnostic failed]", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
