import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";

interface Waiter {
  bytes: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Process-wide cap on in-flight file-processing bytes. Each operation that
 * loads a file into memory (pdf-parse, full-buffer getObject, etc.) should
 * acquire(actualSize) before reading and release(actualSize) when done.
 *
 * Acquisitions that don't fit are queued in FIFO order and admitted as
 * earlier acquisitions release. Queued acquisitions reject with 503 after
 * maxWaitMs so the request doesn't hang indefinitely.
 *
 * Small uploads naturally pass through immediately while the budget has
 * room: a 2 MB acquire only blocks if the inflight total is already within
 * 2 MB of the cap.
 */
@Injectable()
export class FileProcessingBudgetService {
  private readonly logger = new Logger(FileProcessingBudgetService.name);
  private readonly budget: number;
  private readonly maxWaitMs: number;
  private inflight = 0;
  private waiters: Waiter[] = [];

  constructor() {
    this.budget = this.parseBytesFromEnv(
      process.env.FILE_PROCESSING_BUDGET_BYTES,
      1000 * 1024 * 1024,
    );
    this.maxWaitMs = this.parseIntFromEnv(
      process.env.FILE_PROCESSING_QUEUE_TIMEOUT_MS,
      60_000,
    );
  }

  async acquire(bytes: number): Promise<void> {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      throw new Error("acquire(bytes): bytes must be a positive number");
    }
    if (bytes > this.budget) {
      this.logger.warn(
        `Acquire rejected — request larger than budget: ` +
          `requested=${bytes} budget=${this.budget}`,
      );
      throw new ServiceUnavailableException({
        status: "busy",
        message: "Processing capacity exceeded for this request.",
      });
    }

    if (this.inflight + bytes <= this.budget) {
      this.inflight += bytes;
      this.logger.log(
        `Acquired — inflight=${this.inflight}/${this.budget} ` +
          `claimed=${bytes} waiters=${this.waiters.length}`,
      );
      return;
    }

    this.logger.log(
      `Acquire queued — inflight=${this.inflight}/${this.budget} ` +
        `requested=${bytes} waiters=${this.waiters.length}`,
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        this.logger.warn(
          `Acquire timed out after ${this.maxWaitMs}ms — ` +
            `requested=${bytes} budget=${this.budget} inflight=${this.inflight}`,
        );
        reject(
          new ServiceUnavailableException({
            status: "busy",
            retryAfterMs: 5000,
            message:
              "Processing queue is full. Please wait a moment and try again.",
          }),
        );
      }, this.maxWaitMs);

      this.waiters.push({ bytes, resolve, reject, timer });
    });
  }

  /**
   * Non-blocking variant used for upload admission control. Returns true if
   * the bytes were claimed, false if the budget was full. Callers that get
   * false should return a 503 + retryAfterMs so the client can retry with
   * an explicit "Waiting to upload…" UI state rather than the server
   * silently holding a long-poll connection open.
   */
  tryAcquire(bytes: number): boolean {
    if (!Number.isFinite(bytes) || bytes <= 0) return false;
    if (bytes > this.budget) return false;
    if (this.inflight + bytes <= this.budget) {
      this.inflight += bytes;
      this.logger.log(
        `Claimed — inflight=${this.inflight}/${this.budget} ` +
          `claimed=${bytes} waiters=${this.waiters.length}`,
      );
      return true;
    }
    this.logger.log(
      `Claim rejected — inflight=${this.inflight}/${this.budget} ` +
        `requested=${bytes} waiters=${this.waiters.length}`,
    );
    return false;
  }

  /**
   * Reject a 503 + retryAfterMs body suitable for the upload-admission path.
   * Picks "request larger than budget" (non-retryable) vs "queue full"
   * (retryable) based on whether the request could ever fit.
   */
  buildBusyException(bytes: number): ServiceUnavailableException {
    if (bytes > this.budget) {
      return new ServiceUnavailableException({
        status: "busy",
        message: "Processing capacity exceeded for this request.",
      });
    }
    return new ServiceUnavailableException({
      status: "busy",
      retryAfterMs: 5000,
      message: "Processing queue is full. Please wait a moment and try again.",
    });
  }

  release(bytes: number): void {
    this.inflight = Math.max(0, this.inflight - bytes);
    this.logger.log(
      `Released — inflight=${this.inflight}/${this.budget} ` +
        `freed=${bytes} waiters=${this.waiters.length}`,
    );

    while (
      this.waiters.length > 0 &&
      this.inflight + this.waiters[0].bytes <= this.budget
    ) {
      const next = this.waiters.shift();
      if (!next) break;
      clearTimeout(next.timer);
      this.inflight += next.bytes;
      next.resolve();
    }
  }

  /**
   * Snapshot of pod-local budget state for the admin status endpoint.
   * Values are per-pod and only reflect this replica.
   */
  getStatus(): { budget: number; inflight: number; waiters: number } {
    return {
      budget: this.budget,
      inflight: this.inflight,
      waiters: this.waiters.length,
    };
  }

  private parseBytesFromEnv(
    value: string | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private parseIntFromEnv(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
