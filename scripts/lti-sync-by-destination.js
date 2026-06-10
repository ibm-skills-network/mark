#!/usr/bin/env node
/**
 * Read-only: break down recent LTI grade-sync OUTCOMES by destination LMS host.
 *
 * Answers "is it just one LMS's API?" — decodes each sync's JWT cookie to find
 * the upstream LMS (api.coursera.org, courses.yl.skillsnetwork.site,
 * courses.cognitiveclass.ai, learn.ibm.com, ...) and compares, per host, how
 * many syncs SUCCEEDED vs ERRORED (and with what HTTP status) in a recent
 * window. If one host is all-errors while the others succeed, that host's API
 * is the problem — not our stack.
 *
 * Performs ZERO writes and makes ZERO external calls. Just DB reads + local
 * base64 JWT decode. Safe against production.
 *
 * Env:
 *   WINDOW_MIN   lookback window in minutes (default 60)
 *
 * Run via the existing pod plumbing (mark-api pod has @prisma/client + DB):
 *   LTI_DIAG=scripts/lti-sync-by-destination.js ./scripts/lti-sync-check.sh
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function decodeJwtPayload(jwt) {
  try {
    const parts = (jwt || "").split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function destinationHost(payload) {
  if (!payload) return "unknown";
  const url =
    (payload.grading && payload.grading.lis_outcome_service_url) ||
    payload.lis_outcome_service_url ||
    "";
  try {
    return new URL(url).host;
  } catch {
    return url || "unknown";
  }
}

(async () => {
  const windowMin = Number(process.env.WINDOW_MIN || 60);
  console.log(
    `LTI sync outcomes by destination LMS — last ${windowMin} min — ${new Date().toISOString()}`,
  );
  console.log("Read-only. No writes, no external calls.\n");

  try {
    // Successes completed in the window.
    const successes = await prisma.$queryRawUnsafe(`
      SELECT "authCookie"
      FROM "LtiGradeSync"
      WHERE status = 'SUCCESS' AND "completedAt" > now() - interval '${windowMin} minutes';
    `);

    // Errors logged in the window (joined back to the sync for its cookie).
    const errors = await prisma.$queryRawUnsafe(`
      SELECT s."authCookie", COALESCE(e."httpStatus"::text, 'null') AS http_status
      FROM "LtiSyncErrorLog" e
      JOIN "LtiGradeSync" s ON s.id = e."syncId"
      WHERE e."timestamp" > now() - interval '${windowMin} minutes';
    `);

    // host -> { success, errByStatus: {status: n}, errTotal }
    const byHost = {};
    const host = (h) =>
      (byHost[h] = byHost[h] || { success: 0, errTotal: 0, errByStatus: {} });

    for (const r of successes)
      host(destinationHost(decodeJwtPayload(r.authCookie))).success++;
    for (const r of errors) {
      const h = host(destinationHost(decodeJwtPayload(r.authCookie)));
      h.errTotal++;
      h.errByStatus[r.http_status] = (h.errByStatus[r.http_status] || 0) + 1;
    }

    const rows = Object.entries(byHost)
      .map(([h, v]) => {
        const total = v.success + v.errTotal;
        const failPct = total ? Math.round((v.errTotal / total) * 100) : 0;
        return {
          destination: h,
          success: v.success,
          errors: v.errTotal,
          fail_pct: `${failPct}%`,
          error_statuses: Object.entries(v.errByStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([s, n]) => `${s}:${n}`)
            .join(" "),
        };
      })
      .sort((a, b) => b.errors - a.errors);

    console.log("── Outcomes by destination LMS host ──");
    if (rows.length === 0) console.log("(no activity in window)");
    else console.table(rows);

    const totSucc = rows.reduce((n, r) => n + r.success, 0);
    const totErr = rows.reduce((n, r) => n + r.errors, 0);
    console.log(
      `\nTotals: ${totSucc} success, ${totErr} errors across ${rows.length} destinations.`,
    );
    console.log(
      "Read: a host that is ~all-errors while OTHER hosts succeed = that LMS's API is down, not our stack.",
    );
  } catch (error) {
    console.error("\n[failed]", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
