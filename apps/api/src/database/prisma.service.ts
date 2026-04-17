/**
 * PrismaService - Database Connection Management
 *
 * This service manages the PostgreSQL database connection using Prisma ORM.
 * It implements retry logic, health checks, and graceful connection handling
 * to ensure database stability in production environments.
 *
 * Features:
 * - Automatic retry on connection failure (up to 5 attempts)
 * - Health check functionality for monitoring
 * - Graceful connection/disconnection on module lifecycle
 * - Connection recovery mechanisms
 * - Structured Winston log forwarding for Prisma query/info/warn/error events
 *
 * @module database
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

const SLOW_QUERY_THRESHOLD_MS = 500;

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

@Injectable()
export class PrismaService
  extends PrismaClient<
    Prisma.PrismaClientOptions,
    "query" | "info" | "warn" | "error"
  >
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private retryCount = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;

  /**
   * Initializes the Prisma client with database configuration.
   * Prisma log events are emitted (instead of written to stdout) so they can
   * be forwarded through Winston with structured context.
   */
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: [
        { level: "query", emit: "event" },
        { level: "info", emit: "event" },
        { level: "warn", emit: "event" },
        { level: "error", emit: "event" },
      ],
    });

    this.$on("query", (event) => {
      if (event.duration >= SLOW_QUERY_THRESHOLD_MS) {
        this.logger.warn(`slow_query: ${event.duration}ms ${event.query}`, {
          prisma_event: "query",
          duration_ms: event.duration,
          query: event.query,
          params: event.params,
          target: event.target,
        } as unknown as Record<string, unknown>);
      } else {
        this.logger.debug(`query: ${event.duration}ms ${event.query}`, {
          prisma_event: "query",
          duration_ms: event.duration,
          query: event.query,
        } as unknown as Record<string, unknown>);
      }
    });

    this.$on("info", (event) => {
      this.logger.log(`prisma_info: ${event.message}`, {
        prisma_event: "info",
        target: event.target,
      } as unknown as Record<string, unknown>);
    });

    this.$on("warn", (event) => {
      this.logger.warn(`prisma_warn: ${event.message}`, {
        prisma_event: "warn",
        target: event.target,
      } as unknown as Record<string, unknown>);
    });

    this.$on("error", (event) => {
      this.logger.error(`prisma_error: ${event.message}`, {
        prisma_event: "error",
        target: event.target,
      } as unknown as Record<string, unknown>);
    });
  }

  /**
   * Lifecycle hook called when the module initializes
   * Establishes database connection with retry logic
   *
   * @returns {Promise<void>}
   */
  async onModuleInit(): Promise<void> {
    this.logger.log(
      `connecting: DATABASE_URL=${redactDatabaseUrl(process.env.DATABASE_URL)}`,
    );
    await this.connectWithRetry();
  }

  /**
   * Lifecycle hook called when the module is being destroyed
   * Ensures clean disconnection from the database
   *
   * @returns {Promise<void>}
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log("disconnecting");
    await this.$disconnect();
  }

  /**
   * Attempts to connect to the database with exponential backoff retry
   * Will retry up to maxRetries times before throwing an error
   *
   * @private
   * @throws {Error} When max retries exceeded
   * @returns {Promise<void>}
   */
  private async connectWithRetry(): Promise<void> {
    while (this.retryCount < this.maxRetries) {
      try {
        await this.$connect();
        this.logger.log("Database connected successfully");
        this.retryCount = 0;
        return;
      } catch (error) {
        this.retryCount++;
        this.logger.error(
          `Database connection failed. Retry ${this.retryCount}/${this.maxRetries}`,
          error,
        );

        if (this.retryCount === this.maxRetries) {
          throw new Error(
            "Failed to connect to database after maximum retries",
          );
        }

        await this.delay(this.retryDelay);
      }
    }
  }

  /**
   * Checks if the database connection is healthy
   * Executes a simple SELECT query to verify connectivity
   *
   * @returns {Promise<boolean>} True if healthy, false otherwise
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error("Database health check failed:", error);
      return false;
    }
  }

  /**
   * Attempts to reconnect to the database
   * Disconnects existing connection and establishes a new one
   *
   * @throws {Error} When reconnection fails
   * @returns {Promise<void>}
   */
  async reconnect(): Promise<void> {
    try {
      this.logger.warn("reconnect: initiating");
      await this.$disconnect();
      await this.$connect();
      this.logger.log("Database reconnected successfully");
    } catch (error) {
      this.logger.error("Failed to reconnect to database:", error);
      throw error;
    }
  }

  /**
   * Utility function to create a delay
   * Used for implementing retry backoff strategy
   *
   * @private
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
