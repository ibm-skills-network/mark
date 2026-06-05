/* eslint-disable unicorn/prefer-module */
// Instana must initialize before any other import so it can instrument http /
// ioredis before bullmq loads. Gate mirrors isInstanaEnabled() in
// ./instrumentation/instana-job-tracing — kept inlined here so this runs
// before module imports rather than importing the helper.
if (
  (process.env.NODE_ENV === "production" ||
    process.env.INSTANA_ENABLED === "true") &&
  process.env.INSTANA_ENABLED !== "false"
) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires
  require("@instana/collector")({ autoProfile: true });
}
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WinstonModule } from "nest-winston";
import { JobsAppModule } from "./app.module";
import { winstonOptions } from "./logger.config";
import { registerProcessSafetyHandlers } from "./process-safety";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(JobsAppModule, {
    logger: WinstonModule.createLogger(winstonOptions),
  });
  const logger = new Logger("JobsBootstrap");

  // Last-resort safety net: log escaping async rejections / sync throws and
  // keep the worker alive rather than letting one bad job (e.g. a pdfjs
  // "Image or Canvas expected" rejection) exit the process and take every
  // co-running grading job down with it. Native SIGSEGVs are NOT catchable
  // here — those are contained by isolating PDF extraction in a child process.
  registerProcessSafetyHandlers(logger);

  logger.log("Jobs worker application context started");

  let shutdownPromise: Promise<void> | undefined;
  const shutdown = async (signal: string) => {
    shutdownPromise ??= (async () => {
      logger.log(`Received ${signal}, shutting down jobs worker`);
      await app.close();
    })();
    await shutdownPromise;
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger("JobsBootstrap");
  logger.error("Jobs worker failed to start", error);
  process.exitCode = 1;
});
