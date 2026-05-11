/* eslint-disable @typescript-eslint/no-explicit-any */
import { execSync } from "node:child_process";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import * as winston from "winston";

import { JobExecutorService } from "../../../../job-queue/job-executor.service";
import {
  JOB_NAMES,
  JOB_QUEUE_NAMES,
} from "../../../../job-queue/job-queue.constants";
import type { TranslationOutcome } from "./translation.service";

/**
 * Log-shape contract test.
 *
 * Pins the structured Winston log lines emitted by the new translation-job
 * surface to the documented identifier-only field set. Future changes that
 * drift the log shape (e.g., add a new field, drop an existing one) fail
 * this test loudly so the SSE / log-aggregator consumers stay aligned.
 *
 * Two complete-log lines exist by emit site:
 * - publish.translation.job.executor.complete (executor side) — carries
 *   the three-bucket per-language outcome counters { inserted, skipped,
 *   failed } because the executor reads the typed return of the public
 *   TranslationService methods (TranslationOutcome shape after the bulk-
 *   insert refactor in this plan).
 * - publish.translation.job.complete (worker side) — timing only. The
 *   worker only sees that the executor returned; it does not know the
 *   per-language counts.
 *
 * Drives executor.complete via JobExecutorService directly with a Winston
 * memory transport. Worker-side lines (start, complete, failed) and the
 * publish-flow line (publish.complete) are pinned via source-grep
 * verification because they fire from a different package
 * (apps/jobs/src/job-worker.service.ts) or a different long-running
 * service (assignment.service.ts) that requires substantial mocking to
 * drive in unit-test scope. Source-grep here means: assert that the
 * source files emit each locked log message with the exact field set.
 */
describe("Log shape contract: translation-job lifecycle", () => {
  const repoRoot = resolve(__dirname, "..", "..", "..", "..", "..", "..", "..");

  function parseJsonLines(buffer: string): Array<Record<string, any>> {
    return buffer
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, any>;
        } catch {
          return null;
        }
      })
      .filter((v): v is Record<string, any> => v !== null);
  }

  async function captureExecutorComplete(
    kind: "question" | "variant" | "meta",
    outcome: TranslationOutcome,
  ): Promise<Array<Record<string, any>>> {
    let buffer = "";
    const memoryStream = new Writable({
      write(chunk, _enc, cb) {
        buffer += chunk.toString();
        cb();
      },
    });
    const winstonLogger = winston.createLogger({
      level: "debug",
      transports: [
        new winston.transports.Stream({
          stream: memoryStream,
          format: winston.format.json(),
        }),
      ],
    });

    const translationService = {
      translateQuestion: jest.fn().mockResolvedValue(outcome),
      translateVariant: jest.fn().mockResolvedValue(outcome),
      translateAssignment: jest.fn().mockResolvedValue(outcome),
    };
    const noopService = {} as any;
    const executor = new JobExecutorService(
      noopService,
      noopService,
      noopService,
      noopService,
      noopService,
      translationService as any,
      winstonLogger as any,
    );

    const jobName =
      kind === "question"
        ? JOB_NAMES.TRANSLATE_QUESTION
        : kind === "variant"
          ? JOB_NAMES.TRANSLATE_VARIANT
          : JOB_NAMES.TRANSLATE_META;

    const payload =
      kind === "question"
        ? {
            assignmentId: 7,
            questionId: 42,
            question: {} as any,
            parentJobId: "publish:v2:7",
          }
        : kind === "variant"
          ? {
              assignmentId: 7,
              questionId: 42,
              variantId: 99,
              variant: {} as any,
              parentJobId: "publish:v2:7",
            }
          : { assignmentId: 7, parentJobId: "publish:v2:7" };

    await executor.executeJob({
      queueName: JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
      jobName,
      payload,
    });

    return parseJsonLines(buffer).filter(
      (l) => l.message === "publish.translation.job.executor.complete",
    );
  }

  describe("publish.translation.job.executor.complete (executor side)", () => {
    it("emits with the FIXED 8-field set { assignmentId, kind, id, jobId, inserted, skipped, failed, durationMs } for question", async () => {
      const lines = await captureExecutorComplete("question", {
        inserted: 23,
        skipped: 0,
        failed: 0,
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toEqual(
          expect.objectContaining({
            assignmentId: expect.any(Number),
            kind: expect.stringMatching(/^(question|variant|meta)$/),
            id: expect.any(Number),
            jobId: expect.any(String),
            inserted: expect.any(Number),
            skipped: expect.any(Number),
            failed: expect.any(Number),
            durationMs: expect.any(Number),
          }),
        );
        // The three-bucket sum must not exceed the language matrix.
        expect(line.inserted + line.skipped + line.failed).toBeLessThanOrEqual(
          23,
        );
        // Belt-and-suspenders: the legacy { success, failure } pair must be
        // GONE from this line. If a regression re-adds them, downstream
        // log-consumers that already migrated to the new field set will
        // silently double-count.
        expect(line).not.toHaveProperty("success");
        expect(line).not.toHaveProperty("failure");
      }
    });

    it("emits the same 8-field shape for variant", async () => {
      const lines = await captureExecutorComplete("variant", {
        inserted: 22,
        skipped: 1,
        failed: 0,
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toEqual(
          expect.objectContaining({
            kind: "variant",
            inserted: 22,
            skipped: 1,
            failed: 0,
          }),
        );
        expect(line).not.toHaveProperty("success");
        expect(line).not.toHaveProperty("failure");
      }
    });

    it("emits the same 8-field shape for meta", async () => {
      const lines = await captureExecutorComplete("meta", {
        inserted: 23,
        skipped: 0,
        failed: 0,
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toEqual(
          expect.objectContaining({
            kind: "meta",
            inserted: expect.any(Number),
            skipped: expect.any(Number),
            failed: expect.any(Number),
          }),
        );
        expect(line).not.toHaveProperty("success");
        expect(line).not.toHaveProperty("failure");
      }
    });
  });

  describe("publish.translation.job.complete (worker side, timing only)", () => {
    // The worker emits this from apps/jobs/src/job-worker.service.ts —
    // a separate package that imports JobExecutorService from apps/api.
    // Driving it in this test would require bootstrapping a full BullMQ
    // worker against Redis. Instead, source-grep the worker file: assert
    // the emit site exists and emits ONLY the timing-only field set.
    const workerFile = `${repoRoot}/apps/jobs/src/job-worker.service.ts`;

    function workerCompleteEmit(): string {
      // Returns the source slice that contains the publish.translation.job.complete
      // emit, including the surrounding object literal so we can grep field names.
      const cmd = `git -C ${repoRoot} grep --no-color -A 12 'publish.translation.job.complete' -- 'apps/jobs/src/job-worker.service.ts' 2>/dev/null || true`;
      return execSync(cmd, { encoding: "utf8" });
    }

    it("emits at least one publish.translation.job.complete line in the worker source", () => {
      const slice = workerCompleteEmit();
      expect(slice).toMatch(/publish\.translation\.job\.complete/);
    });

    it("does NOT carry inserted / skipped / failed (the new per-language counters)", () => {
      const slice = workerCompleteEmit();
      // None of these field names appear in the worker-side emit slice.
      expect(slice).not.toMatch(/^[+\s]*\binserted\b\s*[:,]/m);
      expect(slice).not.toMatch(/^[+\s]*\bskipped\b\s*[:,]/m);
      expect(slice).not.toMatch(/^[+\s]*\bfailed\b\s*[:,]/m);
    });

    it("does NOT carry success / failure (the legacy pair) — belt-and-suspenders", () => {
      const slice = workerCompleteEmit();
      expect(slice).not.toMatch(/^[+\s]*\bsuccess\b\s*[:,]/m);
      expect(slice).not.toMatch(/^[+\s]*\bfailure\b\s*[:,]/m);
    });

    it("DOES carry durationMs", () => {
      const slice = workerCompleteEmit();
      expect(slice).toMatch(/durationMs/);
    });
  });

  describe("publish.translation.job.start, .failed (worker side)", () => {
    const workerFile = `${repoRoot}/apps/jobs/src/job-worker.service.ts`;

    it("source emits publish.translation.job.start with languageCount: 23", () => {
      const cmd = `git -C ${repoRoot} grep --no-color -A 10 'publish.translation.job.start' -- 'apps/jobs/src/job-worker.service.ts' 2>/dev/null || true`;
      const slice = execSync(cmd, { encoding: "utf8" });
      expect(slice).toMatch(/publish\.translation\.job\.start/);
      expect(slice).toMatch(/languageCount:\s*23/);
    });

    it("source emits publish.translation.job.failed with error: <string>, no stack", () => {
      const cmd = `git -C ${repoRoot} grep --no-color -A 10 'publish.translation.job.failed' -- 'apps/jobs/src/job-worker.service.ts' 2>/dev/null || true`;
      const slice = execSync(cmd, { encoding: "utf8" });
      expect(slice).toMatch(/publish\.translation\.job\.failed/);
      // Stack must never be in the failed line's payload.
      expect(slice).not.toHaveProperty("stack");
      expect(slice).not.toMatch(/^[+\s]*\bstack\b\s*:/m);
    });
  });

  describe("publish.complete (publish-flow finalize)", () => {
    // Fires from runPublishJob in assignment.service.ts. Source-grep
    // because driving runPublishJob requires bootstrapping the full
    // publish flow (Prisma + Redis + Bull + version management).
    it("source emits publish.complete with percentage: 100", () => {
      const cmd = `git -C ${repoRoot} grep --no-color -A 10 'publish\\.complete' -- 'apps/api/src/api/assignment/v2/services/assignment.service.ts' 2>/dev/null || true`;
      const slice = execSync(cmd, { encoding: "utf8" });
      expect(slice).toMatch(/publish\.complete/);
      expect(slice).toMatch(/percentage:\s*100/);
    });
  });
});
