#!/usr/bin/env node
/**
 * Read-only lookup of a specific learner's LTI grade-sync rows.
 *
 * Shows every LtiGradeSync row (and its error log) for a user, optionally
 * narrowed to one assignment and/or attempt. Performs ZERO writes — safe
 * against production.
 *
 * Parameters come from env (so no PII is baked into the committed file):
 *   LOOKUP_USER        required — the learner's userId (an email)
 *   LOOKUP_ASSIGNMENT  optional — assignmentId to filter on
 *   LOOKUP_ATTEMPT     optional — attemptId to filter on
 *
 * Run via the existing pod plumbing, e.g.:
 *   pod=$(kubectl get pods -o name | grep -m1 mark-api | cut -d/ -f2)
 *   kubectl exec -i "$pod" -c mark-api -- sh -c \
 *     'NODE_PATH=/usr/src/app/node_modules LOOKUP_USER="x@y.com" LOOKUP_ASSIGNMENT=3723 node' \
 *     < scripts/lti-sync-lookup.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function decodeDestinationHost(jwt) {
  try {
    const parts = (jwt || "").split(".");
    if (parts.length < 2) return "unknown";
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const url =
      (payload.grading && payload.grading.lis_outcome_service_url) ||
      payload.lis_outcome_service_url ||
      "";
    try {
      return new URL(url).host;
    } catch {
      return url || "unknown";
    }
  } catch {
    return "unknown";
  }
}

(async () => {
  const user = process.env.LOOKUP_USER;
  const assignment = process.env.LOOKUP_ASSIGNMENT
    ? Number(process.env.LOOKUP_ASSIGNMENT)
    : undefined;
  const attempt = process.env.LOOKUP_ATTEMPT
    ? Number(process.env.LOOKUP_ATTEMPT)
    : undefined;

  if (!user) {
    console.error("LOOKUP_USER is required");
    process.exit(1);
  }

  const where = { userId: user };
  if (assignment !== undefined) where.assignmentId = assignment;
  if (attempt !== undefined) where.attemptId = attempt;

  console.log(
    `Lookup: user=${user}` +
      (assignment !== undefined ? ` assignment=${assignment}` : "") +
      (attempt !== undefined ? ` attempt=${attempt}` : ""),
  );
  console.log("Read-only. No rows will be modified.\n");

  try {
    const rows = await prisma.ltiGradeSync.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    if (rows.length === 0) {
      console.log(
        "── NO SYNC ROW EXISTS for this user/assignment ──\n" +
          "The grade was never enqueued for sync (no LtiGradeSync row was ever\n" +
          "created). This is the 'never enqueued' case — the queue diagnostics\n" +
          "cannot see it because there is nothing to see.",
      );
      await prisma.$disconnect();
      return;
    }

    console.log(`Found ${rows.length} sync row(s):\n`);
    for (const r of rows) {
      const age = ((Date.now() - r.createdAt.getTime()) / 3_600_000).toFixed(1);
      console.log("═".repeat(78));
      console.log(
        `syncId=${r.id}  status=${r.status}  grade=${r.grade}  retryCount=${r.retryCount}/${r.maxRetries}`,
      );
      console.log(`  attemptId    : ${r.attemptId}`);
      console.log(`  assignmentId : ${r.assignmentId}`);
      console.log(`  destination  : ${decodeDestinationHost(r.authCookie)}`);
      console.log(
        `  createdAt    : ${r.createdAt.toISOString()} (${age}h ago)`,
      );
      console.log(
        `  lastAttemptAt: ${r.lastAttemptAt ? r.lastAttemptAt.toISOString() : "—"}`,
      );
      console.log(
        `  nextRetryAt  : ${r.nextRetryAt ? r.nextRetryAt.toISOString() : "—"}` +
          (r.nextRetryAt
            ? r.nextRetryAt.getTime() < Date.now()
              ? "  (OVERDUE)"
              : "  (in the future — waiting on backoff)"
            : ""),
      );
      console.log(
        `  completedAt  : ${r.completedAt ? r.completedAt.toISOString() : "—"}`,
      );
      console.log(`  lastError    : ${r.lastError || "—"}`);
    }

    const ids = rows.map((r) => r.id);
    const logs = await prisma.ltiSyncErrorLog.findMany({
      where: { syncId: { in: ids } },
      orderBy: { timestamp: "desc" },
      take: 30,
    });

    console.log("\n" + "═".repeat(78));
    console.log(`Error log (${logs.length} most recent across these syncs):`);
    if (logs.length === 0) {
      console.log("  (none)");
    }
    for (const e of logs) {
      console.log(
        `  ${e.timestamp.toISOString()}  syncId=${e.syncId}  attempt#${e.attemptNumber}  http=${e.httpStatus ?? "—"}  ${(e.errorMessage || "").slice(0, 120)}`,
      );
    }
  } catch (error) {
    console.error("\n[lookup failed]", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
