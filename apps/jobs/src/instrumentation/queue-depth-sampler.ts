import type { Logger as WinstonLogger } from "winston";

export interface QueueDepthCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
}

export type QueueCountsProvider = (
  queueName: string,
) => Promise<QueueDepthCounts>;

// Periodically reads each queue's depth and emits it as a structured
// jobs.queue.depth event (surfaced in Instana as a log-based metric, since the
// Node collector has no native gauge API). Owned by the worker lifecycle:
// start() on boot, stop() on shutdown. Sampling errors are logged, never
// thrown — a metrics hiccup must not affect the worker.
export class QueueDepthSampler {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly queueNames: readonly string[],
    private readonly getCounts: QueueCountsProvider,
    private readonly logger: WinstonLogger,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sampleOnce();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async sampleOnce(): Promise<void> {
    for (const queue of this.queueNames) {
      try {
        const counts = await this.getCounts(queue);
        this.logger.info("jobs.queue.depth", { queue, ...counts });
      } catch (error: unknown) {
        this.logger.warn("jobs.queue.depth.sample.failed", {
          queue,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
