import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import {
  parseUserSession,
  rejectionReason,
  type Principal,
} from "./principal.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal;
  }
}

const principalDecorator: FastifyPluginAsync = (app) => {
  const principals = new WeakMap<FastifyRequest, Principal>();
  app.decorateRequest("principal", {
    getter() {
      const principal = principals.get(this);
      if (principal === undefined) {
        throw new Error("request.principal read before requirePrincipal ran");
      }
      return principal;
    },
    setter(value: Principal) {
      principals.set(this, value);
    },
  });
  return Promise.resolve();
};

export const principalPlugin = fp(principalDecorator, {
  name: "principal",
});

// Call inside an encapsulated scope: every route registered in that scope
// then requires a valid gateway user-session header. buildApp registers
// principalPlugin once, so this may be called in sibling and nested scopes.
export function requirePrincipal(app: FastifyInstance): void {
  app.addHook("onRequest", (request, _reply, done) => {
    try {
      request.principal = parseUserSession(
        request.headers["user-session"] as string | undefined,
      );
      done();
    } catch (err) {
      request.log.warn(
        { reason: rejectionReason(err) ?? "unknown", requestId: request.id },
        "session.rejected",
      );
      done(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
