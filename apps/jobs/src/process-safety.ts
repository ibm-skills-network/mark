import type { Logger } from "@nestjs/common";

type ErrorLogger = Pick<Logger, "error">;

function describeError(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack };
  }
  return { message: String(value) };
}

/**
 * Register last-resort process-level handlers so an escaping async rejection
 * or sync throw is logged with context instead of exiting the worker.
 *
 * Why survive instead of crash: the mark-jobs worker runs up to
 * GRADING_WORKER_CONCURRENCY grading jobs concurrently in a single process.
 * Exiting on one bad job (historically an unhandled "AbortException: Image or
 * Canvas expected" thrown from pdfjs after the worker moved on) kills every
 * co-running job too and churns the pod. Logging + surviving keeps the other
 * in-flight jobs intact; the offending job is still failed by BullMQ's own
 * timeout / maxStalledCount=0 path on the ATTEMPT queue.
 *
 * NOTE: this CANNOT catch a native SIGSEGV (e.g. a crash inside the canvas
 * addon) — that is an OS signal, not a JS exception. Native-crash containment
 * is handled separately by isolating PDF extraction in a child process.
 *
 * `target` is injectable so tests can drive the handlers without touching the
 * real process; it defaults to `process`.
 */
export function registerProcessSafetyHandlers(
  logger: ErrorLogger,
  target: NodeJS.EventEmitter = process,
): void {
  target.on("unhandledRejection", (reason: unknown) => {
    const { message, stack } = describeError(reason);
    logger.error(`unhandledRejection (worker kept alive): ${message}`, stack);
  });

  target.on("uncaughtException", (error: unknown) => {
    const { message, stack } = describeError(error);
    logger.error(`uncaughtException (worker kept alive): ${message}`, stack);
  });
}
