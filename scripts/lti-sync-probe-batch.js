#!/usr/bin/env node
/**
 * Probe a batch of recent SCHEDULED syncs against the LTI gateway.
 * Bypasses the admin endpoint and the DB update path — just makes the
 * raw PUT to see what each attempt would actually return.
 *
 * Decodes each sync's JWT cookie payload to identify the upstream
 * LMS (api.coursera.org, courses.yl.skillsnetwork.site, learn.ibm.com)
 * so we can see if failures are clustered by destination.
 *
 * Args:
 *   --count=15  number of rows to probe (default 15)
 *   --rate=2    requests per second (default 2)
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function argVal(name, def) {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return def;
}

function decodeJwtPayload(jwt) {
  try {
    const parts = jwt.split(".");
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
  const count = Number(argVal("count", 15));
  const rateRps = Number(argVal("rate", 2));
  const delayMs = Math.round(1000 / rateRps);

  const rows = await prisma.ltiGradeSync.findMany({
    where: {
      status: "SCHEDULED",
      createdAt: { gte: new Date("2026-05-25T18:31:00Z") },
      retryCount: { lt: 3 },
    },
    orderBy: { createdAt: "desc" },
    take: count,
  });

  console.log(`Probing ${rows.length} rows at ${rateRps} req/s\n`);
  console.log(
    "id      | dest_host                            | status | ms    | body excerpt",
  );
  console.log(
    "--------+--------------------------------------+--------+-------+-------------",
  );

  const byHostStatus = {};
  for (const row of rows) {
    const payload = decodeJwtPayload(row.authCookie || "");
    const host = destinationHost(payload);
    const targetUrl = row.ltiGatewayUrl || "http://mark-lti-gateway/grade";
    const start = Date.now();
    let status = "ERR";
    let body = "";
    try {
      const r = await fetch(targetUrl, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `authentication=${row.authCookie}`,
        },
        body: JSON.stringify({ score: row.grade }),
        signal: AbortSignal.timeout(35_000),
      });
      status = String(r.status);
      try {
        body = (await r.text()).slice(0, 80);
      } catch {
        body = "[unreadable]";
      }
    } catch (e) {
      status = "TIMEOUT/ERR";
      body = `${e.name}: ${e.message}`.slice(0, 80);
    }
    const ms = Date.now() - start;
    console.log(
      `${String(row.id).padEnd(8)}| ${host.padEnd(36)} | ${status.padEnd(7)}| ${String(ms).padStart(5)} | ${body}`,
    );

    const key = `${host}::${status}`;
    byHostStatus[key] = (byHostStatus[key] || 0) + 1;

    await new Promise((r) => setTimeout(r, delayMs));
  }

  console.log("\n── Summary by destination + status ──");
  for (const [k, v] of Object.entries(byHostStatus).sort()) {
    console.log(`  ${k}: ${v}`);
  }

  await prisma.$disconnect();
})();
