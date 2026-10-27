import fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";
import type { Logger } from "pino";

export type HealthServerDeps = {
  logger: Logger;
  isReady: () => boolean;
};

// Probe-only server for the worker; never queries the database inline.
export function buildHealthServer(deps: HealthServerDeps): FastifyInstance {
  const loggerInstance: FastifyBaseLogger = deps.logger;
  const app = fastify({
    loggerInstance,
    logController: new LogController({ disableRequestLogging: true }),
  });

  app.get("/health/liveness", () => ({ status: "ok" as const }));

  app.get("/health/readiness", (_request, reply) => {
    if (deps.isReady()) {
      return { status: "ok" as const, checks: { database: "ok" as const } };
    }
    return reply
      .code(503)
      .send({ status: "degraded", checks: { database: "fail" } });
  });

  return app;
}
