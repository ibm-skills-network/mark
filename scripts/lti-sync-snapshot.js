#!/usr/bin/env node
/**
 * Read-only one-line snapshot of LTI sync backlog + recent error rate.
 * For quick before/after comparisons (e.g. around a gateway restart).
 *
 * Run via a mark-api pod (has @prisma/client + DB):
 *   kubectl exec -i <mark-api-pod> -c mark-api -- \
 *     sh -c 'NODE_PATH=/usr/src/app/node_modules node' < scripts/lti-sync-snapshot.js
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
  const q = (s) => prisma.$queryRawUnsafe(s);
  try {
    const nonTerminal = await q(`
      SELECT status, COUNT(*)::int AS c
      FROM "LtiGradeSync"
      WHERE status IN ('SCHEDULED','PENDING','IN_PROGRESS')
      GROUP BY status ORDER BY status;
    `);
    const e2 = (
      await q(
        `SELECT COUNT(*)::int AS c FROM "LtiSyncErrorLog" WHERE "timestamp" > now() - interval '2 minutes';`,
      )
    )[0].c;
    const e10 = (
      await q(
        `SELECT COUNT(*)::int AS c FROM "LtiSyncErrorLog" WHERE "timestamp" > now() - interval '10 minutes';`,
      )
    )[0].c;
    const parts =
      nonTerminal.map((r) => `${r.status}=${r.c}`).join(" ") || "(none)";
    console.log(
      `SNAPSHOT ${new Date().toISOString()} | non-terminal: ${parts} | errors last2m=${e2} last10m=${e10}`,
    );
  } finally {
    await prisma.$disconnect();
  }
})();
