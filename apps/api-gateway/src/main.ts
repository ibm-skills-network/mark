import { VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { winstonOptions } from "./logger/config";

async function bootstrap() {
  const logger = WinstonModule.createLogger(winstonOptions);

  try {
    const app = await NestFactory.create(AppModule, {
      cors: false,
      logger,
    });
    app.use(json({ limit: "1000mb" }));
    app.use(urlencoded({ limit: "1000mb", extended: true }));
    app.setGlobalPrefix("api", {
      exclude: ["health", "health/liveness", "health/readiness"],
    });

    app.enableVersioning({
      type: VersioningType.URI,
    });

    app.use(helmet());

    app.use(cookieParser());

    const config = new DocumentBuilder()
      .setTitle("API")
      .setDescription("API Description")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document, {
      customSiteTitle: "API Docs",
      customCss: ".swagger-ui .topbar .topbar-wrapper { display: none; }",
    });

    app.enableShutdownHooks();

    const port = process.env.API_GATEWAY_PORT ?? 3000;
    await app.listen(port, "0.0.0.0");

    logger.log(`🚀 API Gateway is running on port ${port}`);
    logger.log(
      `📚 API Documentation available at http://localhost:${port}/api`,
    );
  } catch (error) {
    logger.error("❌ Failed to start API Gateway:", error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
}

void bootstrap();
