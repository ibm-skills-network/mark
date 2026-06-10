import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
// The span-tag allowlist is single-sourced in the api (job-domain-ids) so the
// worker and the admin failed-jobs view can never drift.
import { pickDomainIds } from "../../../api/src/job-queue/job-domain-ids";
import { decryptJobPayload } from "../job-payload.crypto";

const logger = new Logger("InstanaJobTracing");

// Minimal typed view of the slice of @instana/collector we use. The package
// ships types but declares `.sdk` as `any`; declaring our own interface keeps
// this module free of `any` while documenting exactly what we depend on.
export interface InstanaAsyncSdk {
  startEntrySpan(name: string, tags?: Record<string, unknown>): Promise<void>;
  completeEntrySpan(error?: Error | null, tags?: Record<string, unknown>): void;
}

export interface InstanaSpanHandle {
  annotate(path: string, value: unknown): void;
}

export interface InstanaInstance {
  sdk: { async: InstanaAsyncSdk };
  currentSpan(): InstanaSpanHandle;
  isTracing(): boolean;
}

// Test seam: when set, resolveInstana() returns this instead of requiring the
// real collector. `null` forces the disabled path. Production code never calls
// the setters.
let testOverride: { value: InstanaInstance | null } | undefined;

export function __setInstanaTestOverride(value: InstanaInstance | null): void {
  testOverride = { value };
}

export function __clearInstanaTestOverride(): void {
  testOverride = undefined;
}

// Single source of truth for the enablement gate. Mirrored (inlined) in
// main.ts because the collector require must run before other imports.
export function isInstanaEnabled(): boolean {
  const flag = process.env.INSTANA_ENABLED;
  if (flag === "false") return false;
  return process.env.NODE_ENV === "production" || flag === "true";
}

// Returns the initialized collector singleton, or undefined when Instana is
// off or unavailable. main.ts initializes the collector under the same gate,
// so when enabled this require resolves the already-initialized instance.
export function resolveInstana(): InstanaInstance | undefined {
  if (testOverride) return testOverride.value ?? undefined;
  if (!isInstanaEnabled()) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, unicorn/prefer-module
    const instana = require("@instana/collector") as InstanaInstance;
    return instana;
  } catch (error: unknown) {
    // Enabled but the package can't load: degrade to untraced rather than
    // crashing the worker. Logged so the misconfiguration is visible.
    logger.warn(
      `Instana enabled but collector unavailable: ${messageOf(error)}`,
    );
    return undefined;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function annotateDomainIds(span: InstanaSpanHandle, job: Job): void {
  let payload: Record<string, unknown>;
  try {
    payload = decryptJobPayload<Record<string, unknown>>(job.data);
  } catch (error: unknown) {
    // Tracing must never fail a job. A decrypt failure means we simply tag
    // fewer dimensions; the job still runs and the span still completes.
    logger.warn(
      `Skipping domain-id span tags; payload decrypt failed for ${job.name}#${
        job.id ?? "unknown"
      }: ${messageOf(error)}`,
    );
    return;
  }
  for (const [field, value] of Object.entries(pickDomainIds(payload))) {
    span.annotate(`sdk.custom.tags.${field}`, value);
  }
}

// Wraps a single BullMQ job in an Instana entry span. Returns work()'s result.
//
// Hard invariant: observability never changes job behavior. work() always
// runs; the job's own error is always rethrown unchanged; any SDK fault is
// caught, logged, and ignored. When Instana is off this is a transparent
// passthrough.
export async function traceJob<T>(
  queueName: string,
  job: Job,
  work: () => Promise<T>,
): Promise<T> {
  const instana = resolveInstana();
  if (!instana) return work();
  const sdk = instana.sdk.async;

  try {
    await sdk.startEntrySpan(`job.${job.name}`);
  } catch (error: unknown) {
    // Could not open a span — run the job untraced rather than failing it.
    logger.warn(
      `Instana startEntrySpan failed for ${job.name}: ${messageOf(error)}`,
    );
    return work();
  }

  annotateUpFront(instana, queueName, job);

  try {
    const result = await work();
    safeAnnotate(instana, "sdk.custom.tags.outcome", "success");
    safeComplete(sdk);
    return result;
  } catch (error: unknown) {
    safeAnnotate(instana, "sdk.custom.tags.outcome", "error");
    if (error instanceof Error) {
      safeAnnotate(instana, "sdk.custom.tags.errorClass", error.name);
    }
    safeComplete(
      sdk,
      error instanceof Error ? error : new Error(String(error)),
    );
    throw error;
  }
}

function annotateUpFront(
  instana: InstanaInstance,
  queueName: string,
  job: Job,
): void {
  // Annotate before work() so even a thrown job carries its dimensions. All
  // best-effort: a broken annotate must never abort the job.
  try {
    const span = instana.currentSpan();
    span.annotate("sdk.custom.tags.jobType", job.name);
    span.annotate("sdk.custom.tags.queue", queueName);
    if (job.id !== undefined) span.annotate("sdk.custom.tags.jobId", job.id);
    span.annotate("sdk.custom.tags.attempt", job.attemptsMade);
    span.annotate("sdk.custom.tags.maxAttempts", job.opts?.attempts ?? 1);
    const startedAt = job.processedOn ?? Date.now();
    const enqueuedAt = job.timestamp ?? startedAt;
    const queueWaitMs = startedAt - enqueuedAt;
    if (queueWaitMs >= 0)
      span.annotate("sdk.custom.tags.queueWaitMs", queueWaitMs);
    annotateDomainIds(span, job);
  } catch (error: unknown) {
    logger.warn(
      `Instana span annotation failed for ${job.name}: ${messageOf(error)}`,
    );
  }
}

function safeAnnotate(
  instana: InstanaInstance,
  path: string,
  value: unknown,
): void {
  try {
    instana.currentSpan().annotate(path, value);
  } catch (error: unknown) {
    logger.warn(`Instana annotate(${path}) failed: ${messageOf(error)}`);
  }
}

function safeComplete(sdk: InstanaAsyncSdk, error?: Error): void {
  try {
    sdk.completeEntrySpan(error);
  } catch (completeError: unknown) {
    logger.warn(
      `Instana completeEntrySpan failed: ${messageOf(completeError)}`,
    );
  }
}
