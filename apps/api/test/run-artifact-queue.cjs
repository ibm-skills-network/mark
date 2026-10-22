// Explicit, on-demand transport smoke. Never loads dev.env, calls LLMs, or
// connects to an existing Redis/COS/database. See artifacts/README.md for scope.
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { randomBytes, randomUUID, createHash } = require("node:crypto");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const root = path.resolve(__dirname, "../../..");
const api = path.join(root, "apps/api");
const name = `mark-artifact-queue-${process.pid}-${randomBytes(3).toString("hex")}`;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
}
async function main() {
  if (!process.argv.includes("--skip-build"))
    run("yarn", ["workspace", "api", "build"], { stdio: "inherit" });
  let started = false;
  let producer, queue, events, worker, redis;
  let unregister;
  try {
    // Dynamic loopback-only port allocation avoids touching existing services.
    run("docker", [
      "run",
      "--rm",
      "-d",
      "--name",
      name,
      "-p",
      "127.0.0.1::6379",
      "redis:7-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ]);
    started = true;
    const port = run("docker", ["port", name, "6379"]).trim().split(":").at(-1);
    assert.match(port, /^\d+$/);
    const localRedisUrl = `redis://127.0.0.1:${port}/0`;
    process.env.REDIS_URL = localRedisUrl;
    process.env.JOB_QUEUE_SECRET = randomBytes(32).toString("hex");
    process.env.NODE_ENV = "test";
    // Compiled API code retains src/* imports. Resolve only against this build.
    unregister = require("tsconfig-paths").register({
      baseUrl: path.join(api, "dist"),
      paths: { "src/*": ["*"] },
    });
    const IORedis = require("ioredis");
    const {
      Worker,
      Queue,
      QueueEvents,
      UnrecoverableError,
    } = require("bullmq");
    const { JobQueueService } = require(
      path.join(api, "dist/job-queue/job-queue.service.js"),
    );
    const { JOB_NAMES, JOB_QUEUE_NAMES } = require(
      path.join(api, "dist/job-queue/job-queue.constants.js"),
    );
    const { decryptJobPayload } = require(
      path.join(api, "dist/job-queue/job-payload.crypto.js"),
    );
    const { parseArtifactIsolated } = require(
      path.join(
        api,
        "dist/api/attempt/artifacts/parser/isolated-artifact-parser.js",
      ),
    );
    const {
      parseArtifactExtractionJob,
      parseCanonicalArtifact,
    } = require("backend-contracts");
    redis = new IORedis(localRedisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => (times < 30 ? 100 : null),
    });
    redis.on("error", () => {});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Disposable Redis did not become ready")),
        15_000,
      );
      redis.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    for (let attempt = 0; ; attempt++) {
      try {
        assert.equal(await redis.ping(), "PONG");
        break;
      } catch (error) {
        if (attempt === 29) throw error;
        await delay(100);
      }
    }
    producer = new JobQueueService();
    queue = new Queue(JOB_QUEUE_NAMES.ATTEMPT_HEAVY, { connection: redis });
    events = new QueueEvents(JOB_QUEUE_NAMES.ATTEMPT_HEAVY, {
      connection: redis,
    });
    await events.waitUntilReady();
    const healthyId = randomUUID(),
      poisonId = randomUUID(),
      retryId = randomUUID();
    // Local originals are the deliberate boundary of this smoke: storage and
    // ownership belong to the separate DB/service integration suite.
    const originals = new Map([
      [
        healthyId,
        {
          bytes: Buffer.from("x".repeat(500) + "\nDECISIVE_TAIL"),
          format: "text",
          filename: "healthy.txt",
        },
      ],
      [
        poisonId,
        {
          bytes: Buffer.from("%PDF-1.7\nnot a PDF"),
          format: "pdf",
          filename: "poison.pdf",
        },
      ],
      [
        retryId,
        {
          bytes: Buffer.from("Recovered source"),
          format: "text",
          filename: "retry.txt",
        },
      ],
    ]);
    const executions = new Map();
    worker = new Worker(
      JOB_QUEUE_NAMES.ATTEMPT_HEAVY,
      async (job) => {
        assert.equal(job.name, JOB_NAMES.ARTIFACT_EXTRACT);
        assert.equal(job.data.algorithm, "aes-256-gcm");
        assert.equal(Object.hasOwn(job.data, "operationId"), false);
        const { operationId } = parseArtifactExtractionJob(
          decryptJobPayload(job.data),
        );
        assert.equal(JSON.stringify(job.data).includes(operationId), false);
        const times = (executions.get(operationId) ?? 0) + 1;
        executions.set(operationId, times);
        if (operationId === retryId && times === 1)
          throw new Error("Synthetic transient dependency outage");
        const original = originals.get(operationId);
        assert.ok(original);
        let parsed;
        try {
          parsed = await parseArtifactIsolated(
            original.bytes,
            original.format,
            original.filename,
            undefined,
            { timeoutMs: 5000 },
          );
        } catch (error) {
          // An invalid source is terminal; it must not consume all retry attempts.
          if (error.code === "corrupt_input")
            throw new UnrecoverableError("Invalid source");
          throw error;
        }
        const sourceId = randomUUID();
        const blocks = parsed.blocks.map((block, index) => ({
          ...block,
          id: `${sourceId}:${index}`,
        }));
        return parseCanonicalArtifact({
          schemaVersion: 1,
          artifactId: randomUUID(),
          createdAt: new Date().toISOString(),
          source: {
            sourceId,
            attemptId: 1,
            checksum: sha(original.bytes),
            byteSize: original.bytes.length,
            mediaType: "text/plain",
            filename: original.filename,
          },
          extractor: {
            name: "queue-smoke",
            version: "1",
            configHash: sha("timeout=5000"),
          },
          status: parsed.omissions.length
            ? "partial"
            : blocks.length
              ? "success"
              : "empty",
          blocks,
          omissions: parsed.omissions,
          metrics: {
            inputBytes: original.bytes.length,
            expandedBytes: parsed.expandedBytes,
            outputBytes: Buffer.byteLength(JSON.stringify(parsed)),
            textCharacters: blocks.reduce(
              (sum, block) => sum + (block.text?.length ?? 0),
              0,
            ),
            blockCount: blocks.length,
            durationMs: 0,
          },
        });
      },
      { connection: redis, concurrency: 1 },
    );
    worker.on("error", () => {});
    await worker.waitUntilReady();
    async function submit(operationId) {
      const jobId = `artifact-${operationId}`;
      await producer.enqueue(
        JOB_QUEUE_NAMES.ATTEMPT_HEAVY,
        JOB_NAMES.ARTIFACT_EXTRACT,
        { operationId },
        { jobId, attempts: 3, backoff: { type: "fixed", delay: 30 } },
      );
      const job = await queue.getJob(jobId);
      assert.ok(job);
      return job;
    }
    await assert.rejects(
      producer.enqueue(JOB_QUEUE_NAMES.ATTEMPT, JOB_NAMES.ARTIFACT_EXTRACT, {
        operationId: healthyId,
      }),
      /heavy queue/,
    );
    const poison = await submit(poisonId);
    const poisonStart = Date.now();
    await assert.rejects(
      poison.waitUntilFinished(events, 15_000),
      /Invalid source/,
    );
    assert.ok(Date.now() - poisonStart < 15_000);
    assert.equal(executions.get(poisonId), 1);
    const healthy = await submit(healthyId);
    const result = await healthy.waitUntilFinished(events, 15_000);
    assert.equal(result.status, "success");
    assert.match(result.blocks[0].text, /DECISIVE_TAIL$/);
    assert.equal(executions.get(healthyId), 1);
    const retried = await submit(retryId);
    const recovered = await retried.waitUntilFinished(events, 15_000);
    assert.equal(recovered.status, "success");
    assert.equal(executions.get(retryId), 2);
    const counts = await queue.getJobCounts("completed", "failed");
    assert.equal(counts.completed, 2);
    assert.equal(counts.failed, 1);
    console.log(
      "PASS artifact queue smoke: encrypted heavy delivery; bounded poison failure; healthy continuation; transient retry; validated canonical result.",
    );
    console.log(
      "Scope: real disposable Redis/BullMQ + compiled queue producer/crypto/contracts/isolated parser. Excludes COS, database leases, API authentication and full JobWorkerService startup; no LLM calls.",
    );
  } finally {
    const closed = await Promise.allSettled([
      worker?.close(true),
      events?.close(),
      queue?.close(),
      producer?.onModuleDestroy(),
    ]);
    redis?.disconnect();
    unregister?.();
    if (started)
      spawnSync("docker", ["rm", "-f", name], {
        stdio: "ignore",
        timeout: 15_000,
      });
    for (const result of closed)
      if (result.status === "rejected")
        console.error("Queue cleanup reported a failure.");
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
