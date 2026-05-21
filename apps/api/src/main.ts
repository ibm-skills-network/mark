/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable unicorn/no-process-exit */
if (process.env.NODE_ENV === "production") {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-var-requires, unicorn/prefer-module
  require("@instana/collector")({ autoProfile: true });
}
/**
 * Application Bootstrap File
 *
 * Main entry point for the NestJS API application. Handles:
 * - Application initialization with security middleware
 * - API versioning and documentation setup
 * - Graceful shutdown configuration for containerized environments
 * - Signal handling for Kubernetes/Docker deployments
 * - Server timeout configurations for long-running requests
 *
 * @module main
 */
import "reflect-metadata";
import { Logger, ValidationPipe, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, urlencoded } from "express";
import helmet from "helmet";
import { WinstonModule } from "nest-winston";
import { AppModule } from "./app.module";
import { AuthModule } from "./auth/auth.module";
import { RolesGlobalGuard } from "./auth/role/roles.global.guard";
import { SerializeDatesInterceptor } from "./common/interceptors/serialize-dates.interceptor";
import { winstonOptions } from "./logger/config";

function redactDatabaseUrl(url: string | undefined): string {
  if (!url) return "<unset>";
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***"; // pragma: allowlist secret
    if (parsed.username) parsed.username = "***"; // pragma: allowlist secret
    return parsed.toString();
  } catch {
    return "<unparseable>";
  }
}

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const bootStart = Date.now();

  logger.log(`booting pid=${process.pid} node=${process.version}`);
  logger.log(
    `env NODE_ENV=${process.env.NODE_ENV ?? "<unset>"} API_PORT=${
      process.env.API_PORT ?? "<unset>"
    } DATABASE_URL=${redactDatabaseUrl(process.env.DATABASE_URL)}`,
  );
  logger.log(
    `feature flags: PGBOUNCER=${process.env.PGBOUNCER ?? "<unset>"} ` +
      `WATSONX_PROJECT_ID=${process.env.WATSONX_PROJECT_ID ? "set" : "<unset>"} ` +
      `SENDGRID_API_KEY=${process.env.SENDGRID_API_KEY ? "set" : "<unset>"}`,
  );

  try {
    /**
     * Create NestJS application with custom configuration
     * - CORS disabled (configure based on your requirements)
     * - Winston logger for structured logging
     */
    const app = await NestFactory.create(AppModule, {
      cors: false,
      logger: WinstonModule.createLogger(winstonOptions),
    });

    const configService = app.get(ConfigService);

    /**
     * Configure request body size limits
     * Increased limits for handling large file uploads or data payloads
     */
    app.use(json({ limit: "1000mb" }));
    app.use(urlencoded({ limit: "1000mb", extended: true }));

    /**
     * Set global API prefix with exclusions for health endpoints
     * Health endpoints remain at root for container orchestration compatibility
     */
    app.setGlobalPrefix("api", {
      exclude: ["health", "health/liveness", "health/readiness"],
    });

    /**
     * Enable URI-based API versioning
     * Allows multiple API versions to coexist (e.g., /api/v1/, /api/v2/)
     */
    app.enableVersioning({
      type: VersioningType.URI,
    });

    /**
     * Security middleware setup
     * - Helmet: Sets various HTTP headers for security
     * - Cookie Parser: Parses cookie headers for session management
     */
    app.use(helmet());
    app.use(cookieParser());

    /**
     * Global validation pipe for request data validation
     * - whitelist: true - Strips properties not defined in DTOs
     */
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

    /**
     * Global authentication/authorization guard
     * Applies role-based access control to all routes
     */
    app.useGlobalGuards(app.select(AuthModule).get(RolesGlobalGuard));

    /**
     * Global serialization interceptor
     * Automatically serializes Date objects to ISO strings in API responses
     */
    app.useGlobalInterceptors(new SerializeDatesInterceptor());

    /**
     * Swagger API documentation setup
     * Provides interactive API documentation at /api endpoint
     */
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

    /**
     * Enable shutdown hooks for graceful termination
     * Ensures proper cleanup of resources on application shutdown
     */
    app.enableShutdownHooks();

    /**
     * Start the application server
     * Uses API_PORT environment variable or defaults to 3000
     */
    const port =
      configService.get<number>("API_PORT") || process.env.API_PORT || 3000;
    await app.listen(port);
    const bootMs = Date.now() - bootStart;
    logger.log(
      `Application is running on port ${port} (boot_time_ms=${bootMs})`,
    );
    logger.log(`Environment: ${process.env.NODE_ENV || "development"}`);

    /**
     * Configure server timeouts for handling long-running requests
     * - keepAliveTimeout: Time to wait for additional data after last request
     * - headersTimeout: Time to wait for complete HTTP headers
     */
    const server = app.getHttpServer() as import("http").Server;
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;

    /**
     * Graceful shutdown handler
     * Ensures all connections are properly closed before exit
     *
     * @param {string} signal - The signal received (SIGTERM, SIGINT, etc.)
     */
    let shutdownPromise: Promise<void> | undefined;
    const shutdown = async (signal: string) => {
      shutdownPromise ??= (async () => {
        logger.log(`${signal} signal received, starting graceful shutdown`);
        const shutdownStart = Date.now();

        const shutdownTimeout = setTimeout(() => {
          logger.error("Graceful shutdown timeout, forcing exit");
          process.exit(1);
        }, 30_000);

        try {
          await app.close();
          clearTimeout(shutdownTimeout);
          logger.log(
            `Application closed successfully (shutdown_time_ms=${
              Date.now() - shutdownStart
            })`,
          );
          process.exit(0);
        } catch (error) {
          clearTimeout(shutdownTimeout);
          logger.error(
            `Error during graceful shutdown after ${
              Date.now() - shutdownStart
            }ms:`,
            error,
          );
          process.exit(1);
        }
      })();

      await shutdownPromise;
    };

    /**
     * Register signal handlers for container orchestration
     * These signals are commonly used by Docker/Kubernetes for shutdown
     */
    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });

    /**
     * Handle uncaught exceptions and unhandled promise rejections
     * Logs the error and initiates graceful shutdown
     */
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      void shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason) => {
      // An unhandled rejection means a promise rejected with no handler
      // attached. We cannot prove the application is in a sound state to
      // keep serving requests (db/cache may be mid-operation, middleware
      // may be partway through writing headers, BullMQ jobs may be in
      // half-acknowledged state), so the safe default is to terminate
      // and let K8s respawn. Prevent recurring crashes by catching
      // expected async failures at the source — see e.g.
      // PdfStructureExtractorService attaching `.catch` to PDF.js
      // background tasks before awaiting.
      let stack: string | undefined;
      let name: string | undefined;
      let serialized: string;
      try {
        if (reason instanceof Error) {
          stack = reason.stack;
          name = reason.name;
          serialized = reason.message;
        } else {
          name = (reason as { constructor?: { name?: string } })?.constructor
            ?.name;
          stack = (reason as { stack?: string })?.stack;
          try {
            serialized = JSON.stringify(reason);
          } catch {
            serialized = String(reason);
          }
        }
      } catch {
        serialized = "<unserializable rejection reason>";
      }

      logger.error(
        `Unhandled promise rejection: ` +
          `name=${name ?? "<unknown>"} message=${String(reason)} ` +
          `serialized=${serialized}`,
        stack,
      );
      void shutdown("UNHANDLED_REJECTION");
    });

    /**
     * Log successful startup information
     */
    logger.log("Application bootstrap completed successfully");
    logger.log(
      `Swagger documentation available at: http://localhost:${port}/api`
    );
    logger.log(`Health check endpoints:`);
    logger.log(`  - http://localhost:${port}/health`);
    logger.log(`  - http://localhost:${port}/health/liveness`);
    logger.log(`  - http://localhost:${port}/health/readiness`);
  } catch (error) {
    // Winston's serializer flattens Error stacks to `[{}]`, hiding the real
    // cause when bootstrap fails. Dump the raw error to stderr first so K8s
    // pod logs show what actually broke before logger.error swallows it.
    console.error("Failed to bootstrap application (raw):", error);
    logger.error("Failed to bootstrap application:", error);
    process.exit(1);
  }
}

/**
 * Execute bootstrap and handle any startup failures
 * Using void operator to explicitly ignore the returned promise
 */
void bootstrap().catch((error) => {
  console.error("Fatal error during application startup:", error);
  process.exit(1);
});
