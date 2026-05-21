if (process.env.NODE_ENV === "production") {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires, unicorn/prefer-module
  require("@instana/collector")({ autoProfile: true });
}
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
  const bootStart = Date.now();

  logger.log(
    `booting pid=${process.pid} node=${process.version} env=${
      process.env.NODE_ENV ?? "<unset>"
    } instana=${process.env.NODE_ENV === "production" ? "on" : "off"}`,
  );
  logger.log(
    `downstream: MARK_API_ENDPOINT=${
      process.env.MARK_API_ENDPOINT ? "set" : "<unset>"
    } LTI_CREDENTIAL_MANAGER_ENDPOINT=${
      process.env.LTI_CREDENTIAL_MANAGER_ENDPOINT ? "set" : "<unset>"
    }`,
  );

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
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          in: "header",
        },
        "bearer",
      )
      .addSecurityRequirements("bearer")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document, {
      customSiteTitle: "API Docs",
      customCss: ".swagger-ui .topbar .topbar-wrapper { display: none; }",
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    app.enableShutdownHooks();

    const port = process.env.API_GATEWAY_PORT ?? 3000;
    await app.listen(port, "0.0.0.0");

    const bootMs = Date.now() - bootStart;
    logger.log(
      `🚀 API Gateway is running on port ${port} (boot_time_ms=${bootMs})`,
    );
    logger.log(
      `📚 API Documentation available at http://localhost:${port}/api`,
    );
  } catch (error) {
    // Winston flattens Error stacks; dump raw first so pod logs surface it.
    console.error("Failed to start API Gateway (raw):", error);
    logger.error("Failed to start API Gateway:", error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  }
}

void bootstrap();
