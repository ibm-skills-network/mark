import { PrismaClient } from "@prisma/client";
import type { Config } from "./config.js";

export function createPrisma(
  config: Pick<Config, "databaseUrl">,
): PrismaClient {
  return new PrismaClient({
    log: [],
    datasources: { db: { url: config.databaseUrl } },
  });
}
