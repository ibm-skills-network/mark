import { buildApp } from "./http/app.js";
import { loadConfig } from "./shared/config.js";
import { createLogger } from "./shared/logger.js";
import { createPrisma } from "./shared/prisma.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const prisma = createPrisma(config);
const app = await buildApp({ config, logger, prisma });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "http.shutdown_started");
  try {
    await app.close();
    await prisma.$disconnect();
    logger.info({ signal }, "http.shutdown_complete");
    process.exit(0);
  } catch (err) {
    logger.error({ err, signal }, "http.shutdown_failed");
    process.exit(1);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, (s) => void shutdown(s));
}

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
  logger.info({ port: config.port }, "http.listening");
} catch (err) {
  logger.error({ err, port: config.port }, "http.listen_failed");
  await prisma.$disconnect();
  process.exit(1);
}
