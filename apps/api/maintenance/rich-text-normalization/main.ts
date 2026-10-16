import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Prisma } from "@prisma/client";
import { connect, digest } from "./database";
import { MigrationRunner } from "./runner";

declare const __RICH_TEXT_MIGRATION_LOCK_HASH__: string;

const help = `Rich-text migration (never runs automatically)
Set RICH_TEXT_MIGRATION_DATABASE_URL to a direct PostgreSQL connection.
audit --origin <https-url> [--scope all|1,2] [--report path]
plan --target <audit-target> --origin <https-url> --scope all|1,2
apply|resume --target <audit-target> --run <id> [--max-updates N]
pause|status|retry-conflicts|rollback --target <audit-target> --run <id>
verify --target <audit-target> --run <id> [--write-boundary-confirmed] [--canary-approved]
audit and plan accept --max-document-bytes (default 4194304, maximum 33554432).
--max-updates is a TOTAL applied-row cap for the run, including prior executions (default 10).
Use verify twice after completion; flags attest separately tested rollout prerequisites.`;

const output = (value: unknown) => console.log(JSON.stringify(value));
const integer = (
  value: string | undefined,
  fallback: number,
  maximum: number,
) => {
  if (value === undefined) return fallback;
  if (
    !/^\d+$/.test(value) ||
    Number(value) < 1 ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  )
    throw new Error("invalid-integer-option");
  return Number(value);
};

export async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean" },
      origin: { type: "string" },
      scope: { type: "string" },
      target: { type: "string" },
      run: { type: "string" },
      report: { type: "string" },
      "max-updates": { type: "string" },
      "max-document-bytes": { type: "string" },
      "write-boundary-confirmed": { type: "boolean" },
      "canary-approved": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  const [command] = positionals;
  if (
    positionals.length !== 1 ||
    ![
      "audit",
      "plan",
      "apply",
      "resume",
      "pause",
      "status",
      "retry-conflicts",
      "verify",
      "rollback",
    ].includes(command)
  )
    throw new Error("command-required-use-help");
  const url = process.env.RICH_TEXT_MIGRATION_DATABASE_URL;
  if (!url) throw new Error("explicit-migration-database-url-required");
  const expectedTarget = values.target ?? "";
  if (command !== "audit" && !expectedTarget)
    throw new Error("explicit-target-required");
  const scope =
    values.scope === "all" || !values.scope
      ? []
      : values.scope.split(",").map((id) => integer(id, 0, 2_147_483_647));
  const origin = values.origin ? new URL(values.origin).origin : "";
  if (
    ["audit", "plan"].includes(command) &&
    (!origin.startsWith("https://") || (command === "plan" && !values.scope))
  )
    throw new Error("https-origin-and-plan-scope-required");
  const byteLimit = integer(
    values["max-document-bytes"],
    4 * 1024 * 1024,
    32 * 1024 * 1024,
  );
  const maxUpdates = integer(
    values["max-updates"],
    10,
    Number.MAX_SAFE_INTEGER,
  );
  const parserVersion = (
    JSON.parse(readFileSync(require.resolve("jsdom/package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const artifact = digest([
    readFileSync(__filename, "utf8"),
    readFileSync(join(__dirname, "worker.js"), "utf8"),
    parserVersion,
    process.versions.node,
    Prisma.prismaVersion,
    __RICH_TEXT_MIGRATION_LOCK_HASH__,
  ]);
  const database = connect(url);
  const runner = new MigrationRunner(
    database,
    url,
    artifact,
    undefined,
    undefined,
    output,
  );
  const stop = () => runner.stop();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    if (command === "audit") {
      const report = {
        ...(await runner.identity()),
        ...(await runner.audit(scope, origin, byteLimit)),
        scope,
        origin,
        byteLimit,
      };
      if (values.report)
        await writeFile(values.report, JSON.stringify(report, null, 2) + "\n", {
          mode: 0o600,
          flag: "wx",
        });
      output(report);
      if (report.quarantined) process.exitCode = 2;
      return;
    }
    if (command === "plan") {
      output(await runner.plan(scope, origin, byteLimit, expectedTarget));
      return;
    }
    if (!values.run) throw new Error("run-id-required");
    const run = await runner.getRun(values.run, expectedTarget);
    if (command === "status") {
      output(await runner.status(run));
      return;
    }
    switch (command) {
      case "apply": {
        await runner.apply(run, maxUpdates);
        break;
      }
      case "resume": {
        await runner.resume(run, maxUpdates);
        break;
      }
      case "pause": {
        await runner.pause(run);
        break;
      }
      case "retry-conflicts": {
        await runner.retryConflicts(run);
        break;
      }
      case "rollback": {
        await runner.rollback(run);
        break;
      }
      case "verify": {
        const result = await runner.verify(
          run,
          !!values["write-boundary-confirmed"],
          !!values["canary-approved"],
        );
        output(result);
        if (!result.clean) process.exitCode = 2;
        break;
      }
    }
    output(await runner.status(run));
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    await database.$disconnect();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    const message =
      error instanceof Error && /^[a-z]+(?:-[a-z]+){1,10}$/.test(error.message)
        ? error.message
        : "migration-failed-details-redacted";
    console.error(JSON.stringify({ error: message }));
    process.exitCode = 1;
  });
