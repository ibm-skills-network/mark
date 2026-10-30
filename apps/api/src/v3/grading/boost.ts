import { Inject, Injectable } from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import type { GradingLogger } from "./contracts";

/**
 * Extra points for a genuine attempt that missed criteria: one point per
 * `pointsPerStep` of the question's points, at most `maxBoost`, never past
 * the question's points. A question out of 4 earns 1; out of 1–3, none.
 */
export const boostConfigSchema = z.strictObject({
  enabled: z.boolean(),
  pointsPerStep: z.number().int().min(1).max(100),
  maxBoost: z.number().int().min(0).max(20),
});
export type BoostConfig = z.infer<typeof boostConfigSchema>;

export const DEFAULT_BOOST_CONFIG: BoostConfig = {
  enabled: false,
  pointsPerStep: 4,
  maxBoost: 3,
};

export const BOOST_CACHE_TTL_MS = 30_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The most a solid attempt can gain on a question out of `maxPoints`. */
export function effortBoostPoints(
  maxPoints: number,
  config: BoostConfig,
): number {
  if (!config.enabled) return 0;
  return Math.min(
    config.maxBoost,
    Math.floor(maxPoints / config.pointsPerStep),
  );
}

export function applyEffortBoost(
  points: number,
  maxPoints: number,
  solidAttempt: boolean,
  config: BoostConfig,
): { points: number; boost: number } {
  if (!solidAttempt) return { points, boost: 0 };
  const boost = round2(
    Math.min(
      effortBoostPoints(maxPoints, config),
      Math.max(0, maxPoints - points),
    ),
  );
  return { points: round2(points + boost), boost };
}

export interface BoostResolverDeps {
  /** The stored config, or null when none was ever saved. */
  read(): Promise<unknown>;
  logger: GradingLogger;
  now?: () => number;
  ttlMs?: number;
}

export class BoostConfigResolver {
  private cached?: { expiresAt: number; config: BoostConfig };

  constructor(private readonly deps: BoostResolverDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  clear(): void {
    this.cached = undefined;
  }

  async get(): Promise<BoostConfig> {
    if (this.cached && this.cached.expiresAt > this.now()) {
      return this.cached.config;
    }
    let stored: unknown;
    try {
      stored = await this.deps.read();
    } catch (error) {
      // Not cached: the next grade reads again. Off means no boost.
      this.deps.logger.warn("grading.boost.read_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return DEFAULT_BOOST_CONFIG;
    }
    const parsed =
      stored === null ? undefined : boostConfigSchema.safeParse(stored);
    if (parsed && !parsed.success) {
      this.deps.logger.warn("grading.boost.invalid_config", {
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    const config = parsed?.success ? parsed.data : DEFAULT_BOOST_CONFIG;
    this.cached = {
      expiresAt: this.now() + (this.deps.ttlMs ?? BOOST_CACHE_TTL_MS),
      config,
    };
    return config;
  }
}

/** The single stored boost setting, cached per worker for 30s. */
@Injectable()
export class GradingBoostService {
  readonly resolver: BoostConfigResolver;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    const logger = parentLogger.child({ context: GradingBoostService.name });
    this.resolver = new BoostConfigResolver({
      logger,
      read: () =>
        this.prisma.gradingBoostConfig.findUnique({
          where: { id: 1 },
          select: { enabled: true, pointsPerStep: true, maxBoost: true },
        }),
    });
  }

  get(): Promise<BoostConfig> {
    return this.resolver.get();
  }

  /** After a PUT, so this worker sees the change at once. */
  invalidate(): void {
    this.resolver.clear();
  }
}
