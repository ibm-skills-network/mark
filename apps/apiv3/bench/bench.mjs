// Latency bench: node bench.mjs --backend a,b --routes routes.json [--session s.json]
// [--conc 1,5] [--n 60,150] [--warmup 3] [--assignment ID] [--attempt ID] [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    backend: { type: "string" },
    routes: { type: "string" },
    session: { type: "string" },
    conc: { type: "string", default: "1,5" },
    n: { type: "string", default: "60,150" },
    warmup: { type: "string", default: "3" },
    assignment: { type: "string" },
    attempt: { type: "string" },
    json: { type: "string" },
  },
});

function fail(msg) {
  process.stderr.write(`bench: ${msg}\n`);
  process.exit(2);
}

const ints = (s, label) =>
  s.split(",").map((x) => {
    const v = Number(x);
    if (!Number.isInteger(v) || v < 0) fail(`bad ${label}: ${x}`);
    return v;
  });

if (!args.backend) fail("--backend is required");
if (!args.routes) fail("--routes is required");

const backends = args.backend.split(",").map((b) => {
  const t = b.trim();
  return {
    label: t,
    base: (/^https?:\/\//.test(t) ? t : `http://${t}`).replace(/\/+$/, ""),
  };
});
const concs = ints(args.conc, "--conc");
const counts = ints(args.n, "--n");
if (concs.some((c) => c < 1)) fail("--conc values must be >= 1");
if (counts.some((c) => c < 1)) fail("--n values must be >= 1");
if (counts.length !== concs.length)
  fail("--n needs one count per --conc level");
const warmup = ints(args.warmup, "--warmup")[0];

const headers = {};
if (args.session)
  headers["user-session"] = JSON.stringify(
    JSON.parse(readFileSync(args.session, "utf8")),
  ).replace(
    /[\u007f-\uffff]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );

const subst = (path) =>
  path.replace(/\{(assignmentId|attemptId)\}/g, (m, k) => {
    const v = k === "assignmentId" ? args.assignment : args.attempt;
    if (v === undefined)
      fail(
        `route uses ${m} but --${k === "assignmentId" ? "assignment" : "attempt"} not given`,
      );
    return encodeURIComponent(v);
  });
const routes = Object.entries(
  JSON.parse(readFileSync(args.routes, "utf8")),
).map(([name, p]) => [name, subst(p)]);

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

async function hit(url) {
  const t = performance.now();
  let ok = false;
  let bytes = 0;
  let error;
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    bytes = (await r.arrayBuffer()).byteLength;
    ok = r.status === 200;
  } catch (e) {
    // a thrown fetch is counted as an error; latency is still recorded
    error = e instanceof Error ? e.message : String(e);
  }
  return { ms: performance.now() - t, ok, bytes, error };
}

async function run(base, path, n, conc) {
  const url = base + path;
  for (let i = 0; i < warmup; i++) await hit(url);
  const lat = [];
  let errors = 0;
  let bytes = 0;
  let next = 0;
  let firstError;
  const worker = async () => {
    while (next < n) {
      next++;
      const r = await hit(url);
      lat.push(r.ms);
      bytes += r.bytes;
      if (!r.ok) errors++;
      firstError ??= r.error;
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, worker));
  const wall = performance.now() - t0;
  lat.sort((a, b) => a - b);
  if (firstError)
    process.stderr.write(
      `bench: ${path} @ ${base} conc=${conc}: ${firstError}\n`,
    );
  return {
    p50: +pct(lat, 0.5).toFixed(1),
    p95: +pct(lat, 0.95).toFixed(1),
    p99: +pct(lat, 0.99).toFixed(1),
    rps: +((n / wall) * 1000).toFixed(1),
    errors,
    bytes: Math.round(bytes / n),
  };
}

const rows = [];
for (const [route, path] of routes)
  for (const [i, conc] of concs.entries())
    for (const be of backends)
      rows.push({
        route,
        conc,
        backend: be.label,
        n: counts[i],
        ...(await run(be.base, path, counts[i], conc)),
      });

const cols = [
  "route",
  "conc",
  "backend",
  "p50",
  "p95",
  "p99",
  "rps",
  "errors",
  "bytes",
];
const lines = [
  `| ${cols.join(" | ")} |`,
  `|${cols.map(() => "---").join("|")}|`,
];
for (const r of rows) lines.push(`| ${cols.map((c) => r[c]).join(" | ")} |`);
process.stdout.write(`${lines.join("\n")}\n`);
if (args.json) writeFileSync(args.json, `${JSON.stringify(rows, null, 2)}\n`);
