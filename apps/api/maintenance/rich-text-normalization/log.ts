import { createLogger, format, transports } from "winston";

// Structured diagnostics go to stderr so stdout stays the machine-readable result.
export const logger = createLogger({
  level: process.env.RICH_TEXT_MIGRATION_LOG_LEVEL ?? "info",
  format: format.combine(format.timestamp(), format.json()),
  defaultMeta: { component: "rich-text-migration" },
  transports: [
    new transports.Console({
      stderrLevels: ["error", "warn", "info", "http", "verbose", "debug"],
    }),
  ],
});

const SLUG = /^[a-z]+(?:-[\da-z]+){1,10}$/;

/**
 * Describes an error without its message, which for database errors can quote
 * row values. Slug messages are this job's own reasons and are kept.
 */
export function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { type: typeof error };
  const exception = error as Error & {
    code?: unknown;
    meta?: { code?: unknown };
  };
  return {
    name: error.name,
    reason: SLUG.test(error.message) ? error.message : undefined,
    code: typeof exception.code === "string" ? exception.code : undefined,
    databaseCode:
      typeof exception.meta?.code === "string"
        ? exception.meta.code
        : undefined,
    stack: error.stack
      ?.split("\n")
      .filter((line) => line.trimStart().startsWith("at "))
      .map((line) => line.trim())
      .slice(0, 12),
  };
}
