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
 *   GRADING_CONCURRENCY       — maxConcurrent ceiling (default 10)
 *   GRADING_OPERATION_TIMEOUT — per-job expiration, ms (default 120_000;
 *                               file-upload grading regularly approaches 90s).
 */
@Injectable()
export class GradingRateLimiterService {
  private readonly logger = new Logger(GradingRateLimiterService.name);
  private readonly limiter: Bottleneck;
  private readonly operationTimeoutMs: number;

  constructor() {
    const concurrency = this.readNumberEnv("GRADING_CONCURRENCY", 10, 1, 200);
    this.operationTimeoutMs = this.readNumberEnv(
      "GRADING_OPERATION_TIMEOUT",
      120_000,
      30_000,
      600_000,
    );

    this.limiter = new Bottleneck({
      maxConcurrent: concurrency,
      minTime: 5,
      highWater: 500,
      strategy: Bottleneck.strategy.OVERFLOW,
      timeout: this.operationTimeoutMs,
    });

    this.logger.log(
      `GradingRateLimiterService initialized concurrency=${concurrency} timeout=${this.operationTimeoutMs}ms`,
    );
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
