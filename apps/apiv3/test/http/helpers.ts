import { pino, type Logger } from "pino";
import { vi, type Mock } from "vitest";
import type { AppDeps } from "../../src/http/app.js";
import type { Config } from "../../src/shared/config.js";

export type LogLine = {
  level: number;
  msg?: string;
  requestId?: string;
  err?: { message?: string; stack?: string };
  [key: string]: unknown;
};

export function captureLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(msg: string) {
        const parsed: LogLine = JSON.parse(msg) as LogLine;
        lines.push(parsed);
      },
    },
  );
  return { logger, lines };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    serviceName: "apiv3-test",
    port: 0,
    logLevel: "debug",
    databaseUrl: "postgresql://unused/test",
    validateResponses: false,
    consumeWork: false,
    dispatchExternalEffects: false,
    workerHealthPort: 0,
    ...overrides,
  };
}

// An untyped mock satisfies $queryRaw's generic PrismaPromise<T> signature.
export function fakePrisma(
  impl: () => Promise<unknown>,
): AppDeps["prisma"] & { $queryRaw: Mock } {
  const $queryRaw = vi.fn();
  $queryRaw.mockImplementation(impl);
  return { $queryRaw };
}
