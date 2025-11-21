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
 *
 * @module database
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private retryCount = 0;
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;

  /**
   * Initializes the Prisma client with database configuration
   * Sets up logging for warnings and errors to stdout
   */
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: [
        { level: "warn", emit: "stdout" },
        { level: "error", emit: "stdout" },
      ],
    });
  }

  /**
   * Lifecycle hook called when the module initializes
   * Establishes database connection with retry logic
   *
   * @returns {Promise<void>}
   */
  async onModuleInit(): Promise<void> {
    await this.connectWithRetry();
  }

  /**
   * Lifecycle hook called when the module is being destroyed
   * Ensures clean disconnection from the database
   *
   * @returns {Promise<void>}
   */
  async onModuleDestroy(): Promise<void> {
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
