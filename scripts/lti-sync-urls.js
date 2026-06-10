#!/usr/bin/env node
/**
 * Read-only: distribution of the per-row `ltiGatewayUrl` by status (recent rows).
 * Reveals whether failing syncs are pointed at a DIFFERENT gateway URL than
 * successful ones (the per-row URL footgun).
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

(async () => {
  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT status,
             COALESCE("ltiGatewayUrl", '(null)') AS gateway_url,
             COUNT(*)::int AS c,
             MIN("createdAt") AS earliest,
             MAX("createdAt") AS latest
      FROM "LtiGradeSync"
      WHERE "createdAt" > now() - interval '3 hours'
      GROUP BY status, "ltiGatewayUrl"
      ORDER BY c DESC
      LIMIT 40;
    `);
    console.table(rows);
  } finally {
    await prisma.$disconnect();
  }
})();
