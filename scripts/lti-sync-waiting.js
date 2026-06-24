#!/usr/bin/env node
/**
 * The honest "who is STILL waiting for their grade sync" report.
 *
 * lti-sync-diagnose.js reports queue *health* — of the syncs we enqueued, are
 * they processing? This script answers the blunt question users actually care
 * about: how many people earned a grade that has NOT reached the LMS?
 *
 * "Still waiting" = an attempt whose grade sync is not SUCCESS and for which no
 * later sync of the same attempt has succeeded. This deliberately counts the
 * orphan states (PENDING / IN_PROGRESS) that the retry cron and the hourly
 * health alarm are both blind to, plus SCHEDULED (retrying) and FAILED.
 *
 * Counts DISTINCT users (userId is the learner's email), not rows.
 *
 * Read-only. Performs zero writes. Safe against production.
 *
 * Run via:  LTI_DIAG=scripts/lti-sync-waiting.js ./scripts/lti-sync-check.sh
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Attempts whose grade has not landed in the LMS: any non-SUCCESS sync row for
// an attempt that has no SUCCESS row anywhere. Reused by the queries below.
const UNSYNCED_CTE = `
  WITH unsynced AS (
    SELECT s."userId", s."attemptId", s."assignmentId", s.status, s."createdAt"
    FROM "LtiGradeSync" s
    WHERE s.status <> 'SUCCESS'
      AND NOT EXISTS (
        SELECT 1 FROM "LtiGradeSync" ok
        WHERE ok."attemptId" = s."attemptId"
          AND ok.status = 'SUCCESS'
      )
  )
`;

function printTable(title, rows) {
  console.log(`\n── ${title} ──`);
  if (!rows || rows.length === 0) {
    console.log("(none — everyone is synced in this scope ✅)");
    return;
  }
  console.table(rows);
}

function banner(headlineUsers, attempts, allUsers, allRows, oldest) {
  const ageHrs = oldest
    ? ((Date.now() - oldest.getTime()) / 3_600_000).toFixed(1)
    : "—";
  console.log(
    "\n========================================================================",
  );
  console.log(`  USERS STILL WAITING FOR SYNC (last 7 days): ${headlineUsers}`);
  console.log(`  ...across ${attempts} attempts`);
  console.log(
    `  All-time still-unsynced users: ${allUsers}  (${allRows} sync rows)`,
  );
  console.log(
    `  Oldest unsynced grade: ${oldest ? oldest.toISOString() : "—"}  (${ageHrs}h ago)`,
  );
  console.log(
    "========================================================================",
  );
}

async function headline() {
  const rows = await prisma.$queryRawUnsafe(`
    ${UNSYNCED_CTE}
    SELECT
      COUNT(DISTINCT "userId")    FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS users_7d,
      COUNT(DISTINCT "attemptId") FILTER (WHERE "createdAt" > now() - interval '7 days')::int AS attempts_7d,
      COUNT(DISTINCT "userId")::int AS users_all,
      COUNT(*)::int                AS rows_all,
      MIN("createdAt")             AS oldest_waiting
    FROM unsynced;
  `);
  const r = rows[0] || {};
  const oldest = r.oldest_waiting ? new Date(r.oldest_waiting) : null;
  banner(
    r.users_7d ?? 0,
    r.attempts_7d ?? 0,
    r.users_all ?? 0,
    r.rows_all ?? 0,
    oldest,
  );
  return r;
}

async function byWindow() {
  const rows = await prisma.$queryRawUnsafe(`
    ${UNSYNCED_CTE},
    windows(label, span) AS (
      VALUES
        ('1h',  interval '1 hour'),
        ('4h',  interval '4 hours'),
        ('6h',  interval '6 hours'),
        ('12h', interval '12 hours'),
        ('24h', interval '24 hours'),
        ('7d',  interval '7 days')
    )
    SELECT w.label                              AS window,
           COUNT(DISTINCT u."userId")::int      AS users_waiting,
           COUNT(DISTINCT u."attemptId")::int   AS attempts,
           COUNT(*) FILTER (WHERE u.status = 'PENDING')::int     AS pending,
           COUNT(*) FILTER (WHERE u.status = 'IN_PROGRESS')::int AS in_progress,
           COUNT(*) FILTER (WHERE u.status = 'SCHEDULED')::int   AS scheduled,
           COUNT(*) FILTER (WHERE u.status = 'FAILED')::int      AS failed
    FROM windows w
    LEFT JOIN unsynced u ON u."createdAt" > now() - w.span
    GROUP BY w.label, w.span
    ORDER BY w.span;
  `);
  printTable(
    "Still waiting, by how recently the grade was earned (cumulative windows)",
    rows,
  );
}

async function orphans() {
  // PENDING / IN_PROGRESS older than 15 min can NOT still be in-flight (the
  // inline send resolves or fails within the 90s gateway timeout) and are NOT
  // picked up by any cron — the retry processor only selects SCHEDULED. These
  // are stranded grades that will never sync without manual intervention.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT status,
           COUNT(*)::int                 AS rows,
           COUNT(DISTINCT "userId")::int AS users,
           MIN("createdAt")              AS oldest,
           MAX("createdAt")              AS newest
    FROM "LtiGradeSync"
    WHERE status IN ('PENDING', 'IN_PROGRESS')
      AND "createdAt" < now() - interval '15 minutes'
    GROUP BY status
    ORDER BY status;
  `);
  printTable(
    "Orphaned >15m in PENDING/IN_PROGRESS — no cron will ever retry these",
    rows,
  );
}

async function main() {
  console.log(`LTI sync — STILL WAITING report — ${new Date().toISOString()}`);
  console.log(
    '"Still waiting" = grade not SUCCESS in the LMS, and no later success for that attempt.',
  );
  console.log(
    "FAILED is shown separately — per the playbook it is ambiguous (the gateway",
  );
  console.log(
    "sometimes 5xx's a response the LMS actually accepted). Verify FAILED vs the LMS.",
  );
  console.log("Read-only. No rows will be modified. Safe against production.");

  let r = {};
  try {
    r = await headline();
    await byWindow();
    await orphans();
  } catch (error) {
    console.error("\n[report failed]", error);
    process.exitCode = 1;
    return;
  } finally {
    await prisma.$disconnect();
  }

  // Repeat the headline number at the bottom so it survives scrollback.
  console.log(
    `\n➡  ${r.users_7d ?? 0} users still waiting for their grade sync in the last 7 days.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
