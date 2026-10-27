import { loadConfig } from "./shared/config.js";
import { createLogger } from "./shared/logger.js";
import { createPrisma } from "./shared/prisma.js";
import { runWorker, type Worker } from "./worker/main.js";

const config = loadConfig(process.env);
const logger = createLogger(config);
const prisma = createPrisma(config);

let worker: Worker;
try {
  worker = await runWorker({ config, logger, prisma });
} catch (err) {
  logger.error({ err }, "worker.start_failed");
  await prisma.$disconnect();
  process.exit(1);
}

// runWorker's own handlers start the drain; stop() is memoised, so this
// awaits that same shutdown and exits once it settles.
async function exitAfterStop(): Promise<void> {
  try {
    await worker.stop();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "worker.stop_failed");
    process.exit(1);
  }
}

for (const s of ["SIGTERM", "SIGINT"] as const) {
  process.on(s, () => void exitAfterStop());
}
