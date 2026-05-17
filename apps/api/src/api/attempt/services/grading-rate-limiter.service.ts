import { Injectable, Logger } from "@nestjs/common";
import Bottleneck from "bottleneck";

/**
 * Dedicated rate limiter for learner/author grading LLM calls.
 *
 * Sized independently from the translation limiter so a single learner's
 * submission can fan out without competing with publish-time translation
 * fan-out.
 *
 * Env tuning:
 *   ENABLE_PARALLEL_GRADING   — master switch (default "true"). When "false",
 *                               concurrency is forced to 1 so the wave
 *                               scheduler degenerates to sequential grading,
 *                               matching the pre-parallelization behavior.
 *   GRADING_CONCURRENCY       — maxConcurrent ceiling (default 10; ignored
 *                               when ENABLE_PARALLEL_GRADING=false).
 *   GRADING_OPERATION_TIMEOUT — per-job expiration, ms (default 120_000;
 *                               file-upload grading regularly approaches 90s).
 */
@Injectable()
export class GradingRateLimiterService {
  private readonly logger = new Logger(GradingRateLimiterService.name);
  private readonly limiter: Bottleneck;
  private readonly operationTimeoutMs: number;
  public readonly parallelEnabled: boolean;
  public readonly concurrency: number;

  constructor() {
    this.parallelEnabled = this.readBooleanEnv("ENABLE_PARALLEL_GRADING", true);
    const requestedConcurrency = this.readNumberEnv(
      "GRADING_CONCURRENCY",
      10,
      1,
      200,
    );
    this.concurrency = this.parallelEnabled ? requestedConcurrency : 1;
    this.operationTimeoutMs = this.readNumberEnv(
      "GRADING_OPERATION_TIMEOUT",
      120_000,
      30_000,
      600_000,
    );

    this.limiter = new Bottleneck({
      maxConcurrent: this.concurrency,
      minTime: 5,
      highWater: 500,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.operationTimeoutMs,
    });

    this.logger.log(
      `GradingRateLimiterService initialized parallel=${String(this.parallelEnabled)} concurrency=${this.concurrency} timeout=${this.operationTimeoutMs}ms`,
    );
  }

  private readBooleanEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key];
    if (raw === undefined || raw === "") return fallback;
    const normalized = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    this.logger.warn(
      `grading.limiter.env.invalid key=${key} raw=${raw} fallback=${String(fallback)}`,
    );
    return fallback;
  }

  async schedule<T>(
    operationName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await this.limiter.schedule(
        { expiration: this.operationTimeoutMs, priority: 5 },
        operation,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `grading.limiter.rejected operation=${operationName} reason=${message}`,
      );
      throw error;
    }
  }

  private readNumberEnv(
    key: string,
    fallback: number,
    min: number,
    max: number,
  ): number {
    const raw = process.env[key];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      this.logger.warn(
        `grading.limiter.env.invalid key=${key} raw=${raw} fallback=${fallback}`,
      );
      return fallback;
    }
    if (parsed < min || parsed > max) {
      this.logger.warn(
        `grading.limiter.env.out_of_range key=${key} raw=${raw} min=${min} max=${max} fallback=${fallback}`,
      );
      return fallback;
    }
    return parsed;
  }
}
