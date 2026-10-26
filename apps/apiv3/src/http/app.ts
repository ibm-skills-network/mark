import type { PrismaClient } from "@prisma/client";
import fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyInstance,
} from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Logger } from "pino";
import { principalPlugin } from "../modules/access/plugin.js";
import { healthRoutes } from "../modules/health/routes.js";
import type { Config } from "../shared/config.js";
import { requestIdFrom } from "../shared/ids.js";
import errorHandler from "./plugins/error-handler.js";
import requestId from "./plugins/request-id.js";
import responseValidation from "./plugins/response-validation.js";

export type AppDeps = {
  config: Config;
  logger: Logger;
  prisma: Pick<PrismaClient, "$queryRaw">;
};

export const BODY_LIMIT_BYTES = 1048576;

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, logger, prisma } = deps;
  const loggerInstance: FastifyBaseLogger = logger;
  const app = fastify({
    loggerInstance,
    genReqId: (req) => requestIdFrom(req.headers),
    bodyLimit: BODY_LIMIT_BYTES,
    // request.completed is logged by the request-id plugin instead.
    logController: new LogController({ disableRequestLogging: true }),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rule 3: every route outside /health/ declares a response schema.
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/health/")) return;
    if (route.schema?.response === undefined) {
      const method = Array.isArray(route.method)
        ? route.method.join(",")
        : route.method;
      throw new Error(`route ${method} ${route.url} has no response schema`);
    }
  });

  await app.register(requestId, { logger });
  await app.register(errorHandler, { logger });
  await app.register(responseValidation, {
    logger,
    enabled: config.validateResponses,
  });
  // Decorates once at the root; requirePrincipal only adds a hook per scope.
  await app.register(principalPlugin);

  await app.register(healthRoutes, { prisma });
  return app;
}
