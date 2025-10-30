import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

export interface CacheOptions {
  ttl?: number;
  prefix?: string;
}

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private readonly defaultTTL = 300;

  constructor(private readonly configService: ConfigService) {
    const redisUrl = this.configService.get<string>("REDIS_URL");
    const redisHost = this.configService.get<string>("REDIS_HOST", "localhost");
    const redisPort = this.configService.get<number>("REDIS_PORT", 6379);
    const redisPassword = this.configService.get<string>("REDIS_PASSWORD");

    this.client = redisUrl
      ? new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times) => {
            if (times > 3) {
              this.logger.error("Redis connection failed after 3 retries");
              return null;
            }
            return Math.min(times * 200, 1000);
          },
        })
      : new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          retryStrategy: (times) => {
            if (times > 3) {
              this.logger.error("Redis connection failed after 3 retries");
              return null;
            }
            return Math.min(times * 200, 1000);
          },
        });

    this.client.on("connect", () => {
      this.logger.log("Redis client connected");
    });

    this.client.on("error", (error) => {
      this.logger.error("Redis client error:", error);
    });

    this.client.on("ready", () => {
      this.logger.log("Redis client ready");
    });

    this.client.on("close", () => {
      this.logger.warn("Redis client connection closed");
    });

    this.client.on("reconnecting", (delay) => {
      this.logger.log(`Redis client reconnecting in ${delay}ms`);
    });

    this.client.on("end", () => {
      this.logger.warn("Redis client connection ended");
    });
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  /**
   * Get a value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (!value) {
        return null;
      }
      return JSON.parse(value) as T;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set a value in cache with optional TTL
   */
  async set(key: string, value: any, options?: CacheOptions): Promise<void> {
    try {
      const ttl = options?.ttl || this.defaultTTL;
      const serialized = JSON.stringify(value);
      await this.client.setex(key, ttl, serialized);
      this.logger.debug(`Cache set: ${key} (TTL: ${ttl}s)`);
    } catch (error) {
      this.logger.error(`Error setting cache key ${key}:`, error);
    }
  }

  /**
   * Delete a cache key
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
      this.logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key}:`, error);
    }
  }

  /**
   * Delete all cache keys matching a pattern
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
        this.logger.debug(
          `Cache deleted: ${keys.length} keys matching ${pattern}`
        );
      }
    } catch (error) {
      this.logger.error(`Error deleting cache pattern ${pattern}:`, error);
    }
  }

  /**
   * Check if a key exists in cache
   */
  async exists(key: string): Promise<boolean> {
    try {
      const exists = await this.client.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Error checking cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Get remaining TTL for a key
   */
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.error(`Error getting TTL for key ${key}:`, error);
      return -1;
    }
  }

  /**
   * Clear all cache keys
   */
  async flush(): Promise<void> {
    try {
      await this.client.flushall();
      this.logger.log("Cache flushed");
    } catch (error) {
      this.logger.error("Error flushing cache:", error);
    }
  }

  /**
   * Get or set pattern - retrieves from cache or executes function and caches result
   */
  async getOrSet<T>(
    key: string,
    function_: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null) {
        this.logger.debug(`Cache hit: ${key}`);
        return cached;
      }

      this.logger.debug(`Cache miss: ${key}`);
      const result = await function_();
      await this.set(key, result, options);
      return result;
    } catch (error) {
      this.logger.error(`Error in getOrSet for key ${key}:`, error);
      return await function_();
    }
  }

  /**
   * Increment a counter
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error(`Error incrementing key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Decrement a counter
   */
  async decr(key: string): Promise<number> {
    try {
      return await this.client.decr(key);
    } catch (error) {
      this.logger.error(`Error decrementing key ${key}:`, error);
      return 0;
    }
  }

  /**
   * Get multiple values at once
   */
  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.client.mget(...keys);
      return values.map((value) => {
        if (!value) return null;
        try {
          return JSON.parse(value) as T;
        } catch {
          return null;
        }
      });
    } catch (error) {
      this.logger.error("Error getting multiple cache keys:", error);
      return keys.map(() => null);
    }
  }

  /**
   * Set multiple values at once
   */
  async mset(
    keyValuePairs: Record<string, any>,
    options?: CacheOptions
  ): Promise<void> {
    try {
      const pipeline = this.client.pipeline();
      const ttl = options?.ttl || this.defaultTTL;

      for (const [key, value] of Object.entries(keyValuePairs)) {
        const serialized = JSON.stringify(value);
        pipeline.setex(key, ttl, serialized);
      }

      await pipeline.exec();
      this.logger.debug(`Cache set: ${Object.keys(keyValuePairs).length} keys`);
    } catch (error) {
      this.logger.error("Error setting multiple cache keys:", error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    keys: number;
    memory: string;
    hits: number;
    misses: number;
  }> {
    try {
      const info = await this.client.info("stats");
      const dbsize = await this.client.dbsize();
      const memory = await this.client.info("memory");

      const statsMatch = info.match(
        /keyspace_hits:(\d+)[\S\s]*?keyspace_misses:(\d+)/
      );
      const memoryMatch = memory.match(/used_memory_human:([\d.]+[GKM]?)/);

      return {
        keys: dbsize,
        memory: memoryMatch ? memoryMatch[1] : "unknown",
        hits: statsMatch ? Number.parseInt(statsMatch[1], 10) : 0,
        misses: statsMatch ? Number.parseInt(statsMatch[2], 10) : 0,
      };
    } catch (error) {
      this.logger.error("Error getting cache stats:", error);
      return { keys: 0, memory: "unknown", hits: 0, misses: 0 };
    }
  }
}
