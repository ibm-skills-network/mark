import type { PrismaClient } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

export const READINESS_TIMEOUT_MS = 2000;

const liveness = z.object({ status: z.literal("ok") });
const readiness = z.object({
  status: z.enum(["ok", "degraded"]),
  checks: z.object({ database: z.enum(["ok", "fail"]) }),
});

type HealthOptions = {
  prisma: Pick<PrismaClient, "$queryRaw">;
};

class ReadinessTimeoutError extends Error {
  constructor() {
    super(`database check exceeded ${READINESS_TIMEOUT_MS} ms`);
    this.name = "ReadinessTimeoutError";
  }
}

export async function pingDatabase(
  prisma: HealthOptions["prisma"],
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ReadinessTimeoutError()),
      READINESS_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export const healthRoutes: FastifyPluginAsync<HealthOptions> = (
  base,
  { prisma },
) => {
  const app = base.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/health/liveness",
    {
      schema: { response: { 200: liveness } },
      config: { responseSchema: liveness },
    },
    () => ({ status: "ok" as const }),
  );

  app.get(
    "/health/readiness",
    {
      schema: { response: { 200: readiness, 503: readiness } },
      config: { responseSchema: readiness },
    },
    async (request, reply) => {
      try {
        await pingDatabase(prisma);
        return { status: "ok" as const, checks: { database: "ok" as const } };
      } catch (err) {
        request.log.warn(
          {
            requestId: request.id,
            reason: err instanceof Error ? err.name : "unknown",
            detail: err instanceof Error ? err.message : String(err),
          },
          "health.readiness_degraded",
        );
        return reply
          .code(503)
          .send({ status: "degraded", checks: { database: "fail" } });
      }
    },
  );

  return Promise.resolve();
};
