import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export interface CacheOptions {
  ttl?: number;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly defaultTTL = 300;

  constructor(private readonly prisma: PrismaService) {}

  private getExpiration(ttl?: number): Date | null {
    const effectiveTtl = ttl ?? this.defaultTTL;
    return effectiveTtl > 0 ? new Date(Date.now() + effectiveTtl * 1000) : null;
  }

  private async removeIfExpired(key: string, expiresAt?: Date | null) {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      await this.prisma.adminCache
        .delete({ where: { key } })
        .catch(() => undefined);
      return true;
    }
    return false;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = await this.prisma.adminCache.findUnique({ where: { key } });
      if (!entry) return null;

      const expired = await this.removeIfExpired(key, entry.expiresAt);
      if (expired) return null;

      return entry.value as T;
    } catch (error) {
      this.logger.error(`Error getting cache key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, options?: CacheOptions): Promise<void> {
    try {
      const expiresAt = this.getExpiration(options?.ttl);
      await this.prisma.adminCache.upsert({
        where: { key },
        update: { value, expiresAt },
        create: { key, value, expiresAt },
      });
      this.logger.debug(
        `Cache set: ${key} (TTL: ${options?.ttl ?? this.defaultTTL}s)`
      );
    } catch (error) {
      this.logger.error(`Error setting cache key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.prisma.adminCache
        .delete({ where: { key } })
        .catch(() => undefined);
      this.logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache key ${key}:`, error);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      if (!pattern.includes("*")) {
        await this.del(pattern);
        return;
      }

      const prefix = pattern.split("*")[0];
      await this.prisma.adminCache.deleteMany({
        where: prefix ? { key: { startsWith: prefix } } : {},
      });
      this.logger.debug(
        `Cache deleted for pattern ${pattern} (prefix: "${prefix}")`
      );
    } catch (error) {
      this.logger.error(`Error deleting cache pattern ${pattern}:`, error);
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions
  ): Promise<T> {
    try {
      const cached = await this.get<T>(key);
      if (cached !== null) {
        this.logger.debug(`Cache hit: ${key}`);
        return cached;
      }

      this.logger.debug(`Cache miss: ${key}`);
      const result = await factory();
      await this.set(key, result, options);
      return result;
    } catch (error) {
      this.logger.error(`Error in getOrSet for key ${key}:`, error);
      return await factory();
    }
  }

  async flush(): Promise<void> {
    try {
      await this.prisma.adminCache.deleteMany();
      this.logger.log("Admin cache flushed");
    } catch (error) {
      this.logger.error("Error flushing admin cache:", error);
    }
  }

  async clearCache(): Promise<void> {
    await this.flush();
  }

  async purgeExpired(): Promise<void> {
    try {
      await this.prisma.adminCache.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
    } catch (error) {
      this.logger.error("Error purging expired cache entries:", error);
    }
  }
}
