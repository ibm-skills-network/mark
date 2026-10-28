import { Inject, Injectable } from "@nestjs/common";
import { describeError } from "./errors";
import { V3Logger } from "./v3-logger";

/** Injection token for the Instana collector module, or null without it. */
export const INSTANA = "V3_INSTANA";

/** The slice of the @instana/collector SDK v3 uses. */
export type InstanaSpan = {
  getTraceId(): string | null | undefined;
  annotate(path: string, value: unknown): void;
};
export type InstanaCollector = { currentSpan(): InstanaSpan };

/**
 * main.ts initialises the collector in production; this returns the same
 * module so spans can be tagged. Elsewhere tracing is a no-op.
 */
export function loadInstana(): InstanaCollector | null {
  if (process.env.NODE_ENV !== "production") return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment, unicorn/prefer-module
  const collector: InstanaCollector = require("@instana/collector");
  return collector;
}

export type SpanTags = Record<string, string | number | null | undefined>;

/**
 * Tags the current Instana span. Tracing failures never fail a request: they
 * are logged and reported to the caller as a missing trace id or `false`.
 */
@Injectable()
export class V3Tracing {
  private readonly log: V3Logger;

  constructor(
    @Inject(INSTANA) private readonly instana: InstanaCollector | null,
    logger: V3Logger,
  ) {
    this.log = logger.child("tracing");
  }

  traceId(): string | null {
    if (this.instana === null) return null;
    try {
      return this.instana.currentSpan().getTraceId() ?? null;
    } catch (error) {
      // Tracing is best effort: the request goes on without a trace id.
      this.log.warn("v3.tracing.failed", {
        operation: "trace_id",
        error: describeError(error),
      });
      return null;
    }
  }

  tag(tags: SpanTags): boolean {
    if (this.instana === null) return false;
    try {
      const span = this.instana.currentSpan();
      for (const [key, value] of Object.entries(tags)) {
        if (value !== null && value !== undefined) {
          span.annotate(`sdk.custom.tags.${key}`, value);
        }
      }
      return true;
    } catch (error) {
      // Tracing is best effort: the request goes on with fewer span tags.
      this.log.warn("v3.tracing.failed", {
        operation: "tag",
        error: describeError(error),
      });
      return false;
    }
  }
}
