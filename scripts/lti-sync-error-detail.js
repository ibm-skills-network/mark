#!/usr/bin/env node
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT e."syncId", s."attemptId", e."attemptNumber", e."httpStatus",
           COALESCE(e."errorMessage", '') AS error_msg,
           COALESCE(e."responseBody", '') AS response_body,
           e."timestamp"
    FROM "LtiSyncErrorLog" e
    JOIN "LtiGradeSync" s ON s.id = e."syncId"
    WHERE e."timestamp" > now() - interval '15 minutes'
    ORDER BY e."timestamp" DESC
    LIMIT 15;
  `);
  for (const r of rows) {
    console.log("─".repeat(80));
    console.log(
      `syncId=${r.syncId} attemptId=${r.attemptId} attempt#${r.attemptNumber} status=${r.httpStatus} at=${r.timestamp.toISOString()}`,
    );
    console.log(`  msg: ${r.error_msg.slice(0, 300)}`);
    console.log(`  body: ${String(r.response_body).slice(0, 500)}`);
  }
  await prisma.$disconnect();
})();
