/* eslint-disable @typescript-eslint/no-misused-promises */
/* eslint-disable unicorn/no-process-exit */
/**
 * Application Bootstrap File
 *
 * Main entry point for the NestJS API application. Handles:
 * - Application initialization with security middleware
 * - API versioning and documentation setup
 * - Graceful shutdown configuration for containerized environments
 * - Signal handling for Kubernetes/Docker deployments
 * - Server timeout configurations for long-running requests
 * - Instana APM integration for monitoring
 *
 * @module main
 */

import instana from "@instana/collector";
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
import { winstonOptions } from "./logger/config";

// Initialize Instana APM collector for application monitoring
instana();

/**
 * Bootstrap function - initializes and configures the NestJS application
 * Sets up middleware, security, API documentation, and graceful shutdown
 *
 * @throws {Error} When application fails to start or configuration is invalid
 */
async function bootstrap() {
  const logger = new Logger("Bootstrap");

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

    // Get configuration service for environment variables
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
     * Swagger API documentation setup
     * Provides interactive API documentation at /api endpoint
     */
    const config = new DocumentBuilder()
      .setTitle("API")
      .setDescription("API Description")
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api", app, document, {
      customSiteTitle: "API Docs",
      customCss: ".swagger-ui .topbar .topbar-wrapper { display: none; }",
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
    logger.log(`Application is running on port ${port}`);
    logger.log(`Environment: ${process.env.NODE_ENV || "development"}`);

    /**
     * Configure server timeouts for handling long-running requests
     * - keepAliveTimeout: Time to wait for additional data after last request
     * - headersTimeout: Time to wait for complete HTTP headers
     */
    const server = app.getHttpServer() as import("http").Server;
    server.keepAliveTimeout = 65_000; // 65 seconds
    server.headersTimeout = 66_000; // 66 seconds

    /**
     * Graceful shutdown handler
     * Ensures all connections are properly closed before exit
     *
     * @param {string} signal - The signal received (SIGTERM, SIGINT, etc.)
     */
    const shutdown = async (signal: string) => {
      logger.log(`${signal} signal received, starting graceful shutdown`);

      try {
        // Set a timeout for graceful shutdown (30 seconds)
        const shutdownTimeout = setTimeout(() => {
          logger.error("Graceful shutdown timeout, forcing exit");
          throw new Error("Graceful shutdown timeout");
        }, 30_000);

        // Close the NestJS application
        await app.close();

        // Clear the timeout if shutdown completed successfully
        clearTimeout(shutdownTimeout);

        logger.log("Application closed successfully");
        process.exit(0);
      } catch (error) {
        logger.error("Error during graceful shutdown:", error);
        throw error; // Re-throw to trigger process exit
      }
    };

    /**
     * Register signal handlers for container orchestration
     * These signals are commonly used by Docker/Kubernetes for shutdown
     */
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    /**
     * Handle uncaught exceptions and unhandled promise rejections
     * Logs the error and initiates graceful shutdown
     */
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      void shutdown("UNCAUGHT_EXCEPTION");
    });

    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      void shutdown("UNHANDLED_REJECTION");
    });

    /**
     * Log successful startup information
     */
    logger.log("Application bootstrap completed successfully");
    logger.log(
      `Swagger documentation available at: http://localhost:${port}/api`,
    );
    logger.log(`Health check endpoints:`);
    logger.log(`  - http://localhost:${port}/health`);
    logger.log(`  - http://localhost:${port}/health/liveness`);
    logger.log(`  - http://localhost:${port}/health/readiness`);
  } catch (error) {
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
