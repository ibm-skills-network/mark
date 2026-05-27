#!/usr/bin/env node
/**
 * Run a single LTI sync against the gateway with full trace.
 *
 * Picks ONE recent SCHEDULED sync (cookie likely warm), reads its
 * stored gateway URL + cookie + grade, then does the PUT directly
 * with full instrumentation so we see exactly what came back.
 *
 * Read-only against LtiGradeSync (does NOT update any row). It just
 * makes one HTTP request as if the cron were retrying it.
 *
 * Args:
 *   --sync-id=N    use this specific row (otherwise picks newest recent SCHEDULED)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function argVal(name, def) {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return def;
}

(async () => {
  const explicitId = argVal("sync-id");
  let row;
  if (explicitId) {
    row = await prisma.ltiGradeSync.findUnique({
      where: { id: Number(explicitId) },
    });
  } else {
    const rows = await prisma.ltiGradeSync.findMany({
      where: {
        status: "SCHEDULED",
        createdAt: { gte: new Date("2026-05-25T18:31:00Z") },
        retryCount: { lt: 3 },
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    row = rows[0];
  }
  if (!row) {
    console.error("No matching row found");
    process.exit(1);
  }

  const targetUrl = row.ltiGatewayUrl || "http://mark-lti-gateway/grade";
  console.log("Picked sync:", {
    id: row.id,
    attemptId: row.attemptId,
    assignmentId: row.assignmentId,
    userId: row.userId,
    grade: row.grade,
    status: row.status,
    retryCount: row.retryCount,
    createdAt: row.createdAt.toISOString(),
    cookieLength: (row.authCookie || "").length,
    targetUrl,
  });

  const start = Date.now();
  console.log(`\n→ PUT ${targetUrl} at ${new Date().toISOString()}`);
  try {
    const response = await fetch(targetUrl, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: `authentication=${row.authCookie}`,
      },
      body: JSON.stringify({ score: row.grade }),
      signal: AbortSignal.timeout(35_000),
    });
    const elapsed = Date.now() - start;
    const headers = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch (e) {
      bodyText = `[text() failed: ${e.message}]`;
    }
    console.log(`← ${response.status} ${response.statusText} (${elapsed}ms)`);
    console.log("response headers:", headers);
    console.log("response body (first 1500):", bodyText.slice(0, 1500));
  } catch (error) {
    const elapsed = Date.now() - start;
    console.log(`← ERROR after ${elapsed}ms: ${error.name}: ${error.message}`);
  }

  await prisma.$disconnect();
})();
