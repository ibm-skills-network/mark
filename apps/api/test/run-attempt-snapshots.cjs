// On-demand deterministic integration checks. Uses only a disposable local PostgreSQL container.
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { setTimeout } = require("node:timers/promises");
const root = path.resolve(__dirname, "../../..");
const api = path.join(root, "apps/api");
const name = `mark-attempt-test-${process.pid}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed:\n${result.stdout ?? ""}${result.stderr ?? result.error ?? ""}`,
    );
  return result.stdout;
}
(async () => {
  let started = false;
  try {
    const listener = require("node:net").createServer();
    await new Promise((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", resolve);
    });
    const requestedPort = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    run("docker", [
      "run",
      "-d",
      "--name",
      name,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      "-e",
      "POSTGRES_DB=mark_part03",
      "-p",
      `127.0.0.1:${requestedPort}:5432`,
      "postgres:16",
    ]);
    started = true;
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (
        spawnSync(
          "docker",
          ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"],
          { stdio: "ignore" },
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await setTimeout(100);
    }
    if (!ready)
      throw new Error(
        `PostgreSQL did not become ready:\n${spawnSync("docker", ["logs", name], { encoding: "utf8" }).stderr ?? ""}`,
      );
    const port = run("docker", ["port", name, "5432"]).trim().split(":").at(-1);
    const url = `postgresql://postgres@127.0.0.1:${port}/mark_part03`;
    // Container readiness can precede Docker's host port forwarding. Probe the actual client path.
    const { PrismaClient } = require("@prisma/client");
    const probe = new PrismaClient({ datasources: { db: { url } } });
    try {
      for (let n = 0; ; n++) {
        try {
          await probe.$queryRawUnsafe("SELECT 1");
          break;
        } catch (error) {
          if (n === 59) throw error;
          await setTimeout(200);
        }
      }
    } finally {
      await probe.$disconnect();
    }
    const env = {
      ...process.env,
      DATABASE_URL: url,
      DATABASE_URL_DIRECT: url,
      ATTEMPT_TEST_DATABASE_URL: url,
    };
    run(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "db",
        "push",
        "--schema",
        "apps/api/test/fixtures/attempt-snapshot-legacy.prisma",
        "--skip-generate",
      ],
      { env },
    );
    run(
      "docker",
      [
        "exec",
        "-i",
        name,
        "psql",
        "-U",
        "postgres",
        "-d",
        "mark_part03",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        input: `INSERT INTO "AssignmentAttempt" ("assignmentId", "userId", submitted, "questionOrder") VALUES (999999, 'migration-legacy-active', false, ARRAY[999999]); INSERT INTO "AssignmentAttempt" ("assignmentId", "userId", submitted, grade, "questionOrder") VALUES (999999, 'migration-legacy-completed', true, 0.5, ARRAY[999999]);`,
      },
    );
    const began = Date.now();
    run(
      "docker",
      [
        "exec",
        "-i",
        name,
        "psql",
        "-U",
        "postgres",
        "-d",
        "mark_part03",
        "-v",
        "ON_ERROR_STOP=1",
        "--single-transaction",
      ],
      {
        input: [
          "20261022153000_attempt_snapshots",
          "20261022170000_canonical_artifacts",
        ]
          .map((migration) =>
            readFileSync(
              path.join(api, "prisma/migrations", migration, "migration.sql"),
              "utf8",
            ),
          )
          .join("\n"),
      },
    );
    console.log(
      `Additive migration applied in ${Date.now() - began}ms to synthetic legacy fixtures (not a production lock-time estimate).`,
    );
    run(
      process.execPath,
      [
        "node_modules/prisma/build/index.js",
        "generate",
        "--schema",
        "apps/api/prisma/schema.prisma",
      ],
      { env },
    );
    run(process.execPath, [
      "node_modules/typescript/bin/tsc",
      "-p",
      "packages/backend-contracts/tsconfig.json",
    ]);
    const result = spawnSync(
      process.execPath,
      [
        "../../node_modules/jest/bin/jest.js",
        "--runInBand",
        "src/api/attempt/immutable/attempt-snapshot.integration.spec.ts",
        "src/api/files/services/source-retention.integration.spec.ts",
        "src/api/attempt/artifacts/artifact.integration.spec.ts",
      ],
      { cwd: api, env, stdio: "inherit" },
    );
    if (result.status !== 0) process.exitCode = 1;
  } finally {
    if (started)
      spawnSync("docker", ["rm", "-f", "-v", name], { stdio: "ignore" });
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
