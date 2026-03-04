import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { JobsAppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(JobsAppModule);
  const logger = new Logger("JobsBootstrap");

  logger.log("Jobs worker application context started");

  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}, shutting down jobs worker`);
    await app.close();
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger("JobsBootstrap");
  logger.error("Jobs worker failed to start", error);
  process.exitCode = 1;
});
