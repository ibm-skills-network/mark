import type { FastifyError, FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { isResponseSerializationError } from "fastify-type-provider-zod";
import type { Logger } from "pino";
import {
  NotFoundError,
  errorEnvelope,
  type ErrorEnvelope,
} from "../../shared/errors.js";

type ErrorHandlerOptions = { logger: Logger };

export const RESPONSE_SCHEMA_VIOLATION = "RESPONSE_SCHEMA_VIOLATION";

export function responseViolation(requestId: string): ErrorEnvelope {
  return {
    status: 500,
    body: {
      code: RESPONSE_SCHEMA_VIOLATION,
      message: "Response failed validation",
      requestId,
    },
  };
}

function isFastifyError(err: unknown): err is FastifyError {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof err.code === "string" &&
    err.code.startsWith("FST_")
  );
}

const CLIENT_ERRORS: Record<number, { code: string; message: string }> = {
  413: { code: "PAYLOAD_TOO_LARGE", message: "Payload too large" },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Unsupported media type" },
};

// Maps framework errors (schema validation, body parsing, limits) onto the
// generic envelope; never echoes the framework message, which can name fields.
function envelopeFor(err: unknown, requestId: string): ErrorEnvelope {
  if (isResponseSerializationError(err)) return responseViolation(requestId);
  if (isFastifyError(err)) {
    if (err.validation !== undefined) {
      return {
        status: 400,
        body: {
          code: "VALIDATION_FAILED",
          message: "Invalid request",
          requestId,
        },
      };
    }
    const status = err.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      const known = CLIENT_ERRORS[status] ?? {
        code: "BAD_REQUEST",
        message: "Bad request",
      };
      return { status, body: { ...known, requestId } };
    }
  }
  return errorEnvelope(err, requestId);
}

const errorHandlerPlugin: FastifyPluginAsync<ErrorHandlerOptions> = (
  app,
  { logger },
) => {
  app.setErrorHandler((err, request, reply) => {
    const envelope = envelopeFor(err, request.id);
    if (envelope.status >= 500) {
      logger.error({ err, requestId: request.id }, "request.failed");
    } else {
      const code =
        err instanceof Error && "code" in err ? String(err.code) : undefined;
      logger.warn(
        {
          requestId: request.id,
          status: envelope.status,
          code: envelope.body.code,
          errorCode: code,
          reason: err instanceof Error ? err.message : undefined,
        },
        "request.failed",
      );
    }
    return reply.code(envelope.status).send(envelope.body);
  });

  app.setNotFoundHandler((request, reply) => {
    const envelope = errorEnvelope(new NotFoundError("Not found"), request.id);
    return reply.code(envelope.status).send(envelope.body);
  });

  return Promise.resolve();
};

export default fp(errorHandlerPlugin, { name: "error-handler" });
