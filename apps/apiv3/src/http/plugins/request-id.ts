import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { Logger } from "pino";

type RequestIdOptions = { logger: Logger };

// Request ids come from genReqId (akamai-grn / x-request-id / uuid); this echoes
// them back and emits the single per-request access line.
const requestIdPlugin: FastifyPluginAsync<RequestIdOptions> = (
  app,
  { logger },
) => {
  app.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url.split("?", 1)[0],
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      },
      "request.completed",
    );
    done();
  });

  return Promise.resolve();
};

export default fp(requestIdPlugin, { name: "request-id" });
