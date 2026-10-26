import type { PrismaClient } from "@prisma/client";

export const READINESS_TIMEOUT_MS = 2000;

export class ReadinessTimeoutError extends Error {
  constructor() {
    super(`database check exceeded ${READINESS_TIMEOUT_MS} ms`);
    this.name = "ReadinessTimeoutError";
  }
}

// Runs SELECT 1, rejecting with ReadinessTimeoutError past READINESS_TIMEOUT_MS.
export async function pingDatabase(
  prisma: Pick<PrismaClient, "$queryRaw">,
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
