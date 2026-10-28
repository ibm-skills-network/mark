import { Inject, Injectable, Optional } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import type { Logger } from "winston";
import { describeError } from "./errors";
import { currentRequestContext } from "./request-context";

/** Not provided anywhere: the root logger's component defaults to "v3". */
export const V3_LOG_COMPONENT = "V3_LOG_COMPONENT";

export type LogFields = Record<string, unknown>;

const SECRET_KEY =
  /cookie|authorization|password|secret|token|session|api[_-]?key/i;
const MAX_STRING = 2000;
const MAX_DEPTH = 6;

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}…[truncated]`
      : value;
  }
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_DEPTH) return "[depth limit]";
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return clean(describeError(value), depth + 1);
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  const out: LogFields = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : clean(item, depth + 1);
  }
  return out;
}

/** Redacts secret-named keys at any depth and truncates long strings. */
export function sanitizeLogFields(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, item] of Object.entries(fields)) {
    out[key] = SECRET_KEY.test(key) ? "[redacted]" : clean(item, 1);
  }
  return out;
}

type Level = "debug" | "info" | "warn" | "error";

/**
 * The only logger v3 code uses. Each line is
 * `{message: event, event, component, ...requestContext, ...fields}`, so a
 * line written deep inside a service still carries the request's ids.
 */
@Injectable()
export class V3Logger {
  private readonly component: string;

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER) private readonly sink: Logger,
    @Optional() @Inject(V3_LOG_COMPONENT) component?: string,
  ) {
    this.component = component ?? "v3";
  }

  child(component: string): V3Logger {
    return new V3Logger(this.sink, component);
  }

  debug(event: string, fields?: LogFields): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write("error", event, fields);
  }

  private write(level: Level, event: string, fields: LogFields = {}): void {
    const line = sanitizeLogFields({
      message: event,
      event,
      component: this.component,
      ...currentRequestContext(),
      ...fields,
    });
    this.sink.log({ ...line, level, message: event });
  }
}
