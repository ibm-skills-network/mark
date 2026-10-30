import { Body, Get, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { PrismaService } from "../../../database/prisma.service";
import { UseAdmin } from "../../core/admin.guard";
import type { Principal } from "../../core/principal";
import { UseV3Throttle } from "../../core/throttle.guard";
import { V3Principal } from "../../core/principal.guard";
import { V3Controller, V3Route } from "../../core/v3-controller.decorator";
import { V3Logger } from "../../core/v3-logger";
import { ZodPipe } from "../../core/zod.pipe";
import {
  type BoostConfig,
  boostConfigSchema,
  DEFAULT_BOOST_CONFIG,
  GradingBoostService,
} from "../boost";

const BOOST_ROW_ID = 1;

const boostResponseSchema = boostConfigSchema.extend({
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const rowSelect = {
  enabled: true,
  pointsPerStep: true,
  maxBoost: true,
  minScorePercent: true,
  updatedBy: true,
  updatedAt: true,
} as const;

function settings(row: BoostConfig): BoostConfig {
  return {
    enabled: row.enabled,
    pointsPerStep: row.pointsPerStep,
    maxBoost: row.maxBoost,
    minScorePercent: row.minScorePercent,
  };
}

/**
 * The effort-boost setting at /api/v3/grading-settings/boost. Outside
 * /admin so the admin dashboard reaches it as it reaches the LLM settings;
 * the admin guard still requires an admin session. Writes are throttled and
 * logged with before and after.
 */
@V3Controller("grading-settings/boost")
// Decorators apply bottom-up: the admin guard runs first, then the limit.
@UseV3Throttle()
@UseAdmin()
export class GradingBoostController {
  private readonly log: V3Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly boosts: GradingBoostService,
    logger: V3Logger,
  ) {
    this.log = logger.child("grading.boost");
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @V3Route({ response: boostResponseSchema })
  async get() {
    const row = await this.prisma.gradingBoostConfig.findUnique({
      where: { id: BOOST_ROW_ID },
      select: rowSelect,
    });
    this.log.info("grading.boost.read", { saved: row !== null });
    return row
      ? { ...row, updatedAt: row.updatedAt.toISOString() }
      : { ...DEFAULT_BOOST_CONFIG, updatedBy: null, updatedAt: null };
  }

  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @V3Route({ response: boostResponseSchema })
  async put(
    @V3Principal() admin: Principal,
    @Body(new ZodPipe(boostConfigSchema)) body: BoostConfig,
  ) {
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.gradingBoostConfig.findUnique({
        where: { id: BOOST_ROW_ID },
        select: rowSelect,
      });
      const saved = await tx.gradingBoostConfig.upsert({
        where: { id: BOOST_ROW_ID },
        create: { id: BOOST_ROW_ID, ...body, updatedBy: admin.userId },
        update: { ...body, updatedBy: admin.userId },
        select: rowSelect,
      });
      return { before: existing, after: saved };
    });
    this.boosts.invalidate();
    this.log.info("grading.boost.updated", {
      before: before ? settings(before) : null,
      after: settings(after),
    });
    return { ...after, updatedAt: after.updatedAt.toISOString() };
  }
}
