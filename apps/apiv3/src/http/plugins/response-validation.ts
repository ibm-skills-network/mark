import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Logger } from "pino";
import type { ZodType } from "zod";
import { responseViolation } from "./error-handler.js";

declare module "fastify" {
  interface FastifyContextConfig {
    // Zod schema for the 2xx JSON body; set alongside schema.response[200].
    responseSchema?: ZodType;
  }
}

type ResponseValidationOptions = { logger: Logger; enabled: boolean };

function isJson(contentType: unknown): boolean {
  return (
    typeof contentType === "string" &&
    contentType.toLowerCase().startsWith("application/json")
  );
}

// Catches 2xx JSON bodies that bypassed the zod serializer (pre-serialized
// strings, routes without schema.response) and fails them closed.
const responseValidationPlugin: FastifyPluginAsync<
  ResponseValidationOptions
> = (app, { logger, enabled }) => {
  if (!enabled) return Promise.resolve();

  app.addHook("onSend", (request, reply, payload, done) => {
    const schema = request.routeOptions.config.responseSchema;
    if (
      schema === undefined ||
      reply.statusCode < 200 ||
      reply.statusCode >= 300 ||
      typeof payload !== "string" ||
      !isJson(reply.getHeader("content-type"))
    ) {
      done(null, payload);
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(payload);
    } catch (err) {
      logger.error({ err, requestId: request.id }, "response.schema_violation");
      done(null, violation());
      return;
    }
    const result = schema.safeParse(body);
    if (result.success) {
      done(null, payload);
      return;
    }
    logger.error(
      {
        requestId: request.id,
        route: request.routeOptions.url,
        issues: result.error.issues.map((i) => ({
          path: i.path.join("."),
          code: i.code,
        })),
      },
      "response.schema_violation",
    );
    done(null, violation());

    function violation(): string {
      const envelope = responseViolation(request.id);
      void reply
        .code(envelope.status)
        .header("content-type", "application/json; charset=utf-8");
      return JSON.stringify(envelope.body);
    }
  });

  return Promise.resolve();
};

export default fp(responseValidationPlugin, { name: "response-validation" });
