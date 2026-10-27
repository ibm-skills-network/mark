import { pino, type Logger } from "pino";
import type { Config } from "./config.js";

export function createLogger(
  config: Pick<Config, "serviceName" | "logLevel">,
): Logger {
  return pino({
    level: config.logLevel,
    base: { service: config.serviceName },
    redact: {
      paths: [
        "req.headers.cookie",
        "req.headers.authorization",
        'req.headers["user-session"]',
        'req.headers["x-admin-token"]',
        'req.headers["x-job-queue-secret"]',
      ],
      censor: "[redacted]",
    },
  });
}
