import { Body, Get, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Prisma, QuestionType } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../../database/prisma.service";
import { UseAdmin } from "../../core/admin.guard";
import { V3Error } from "../../core/errors";
import type { Principal } from "../../core/principal";
import { V3Principal } from "../../core/principal.guard";
import { UseV3Throttle } from "../../core/throttle.guard";
import { V3Controller, V3Route } from "../../core/v3-controller.decorator";
import { V3Logger } from "../../core/v3-logger";
import { ZodPipe } from "../../core/zod.pipe";
import { GradingModeService, V3_QUESTION_TYPES } from "../mode";

const ENGINE_MODE = { v3: "live", legacy: "off" } as const;

const putEngineSchema = z.strictObject({
  engine: z.enum(["v3", "legacy"]),
});
type PutEngineBody = z.infer<typeof putEngineSchema>;

const engineResponseSchema = z.object({
  engine: z.enum(["v3", "legacy", "mixed"]),
  /** Assignments with their own settings, which this switch does not change. */
  assignmentOverrides: z.number(),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

const rowSelect = {
  questionType: true,
  mode: true,
  updatedBy: true,
  updatedAt: true,
} as const;

type Row = Prisma.GradingModeConfigGetPayload<{ select: typeof rowSelect }>;

/** A type with no global row grades with legacy. */
function modesByType(rows: Row[]): Record<string, string> {
  const modes: Record<string, string> = {};
  for (const questionType of V3_QUESTION_TYPES) {
    modes[questionType] =
      rows.find((row) => row.questionType === questionType)?.mode ?? "off";
  }
  return modes;
}

function engineOf(rows: Row[]): "v3" | "legacy" | "mixed" {
  const modes = Object.values(modesByType(rows));
  if (modes.every((mode) => mode === ENGINE_MODE.v3)) return "v3";
  if (modes.every((mode) => mode === ENGINE_MODE.legacy)) return "legacy";
  return "mixed";
}

/**
 * The global fallback between v3 and legacy grading at
 * /api/v3/grading-settings/engine: every v3 question type moves together.
 * Assignment settings and effort are left alone. Outside /admin so the admin
 * dashboard reaches it as it reaches the LLM settings; the admin guard still
 * requires an admin session. Writes are throttled and logged with before and
 * after.
 */
@V3Controller("grading-settings/engine")
// Decorators apply bottom-up: the admin guard runs first, then the limit.
@UseV3Throttle()
@UseAdmin()
export class GradingEngineController {
  private readonly log: V3Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modes: GradingModeService,
    logger: V3Logger,
  ) {
    this.log = logger.child("grading.engine");
  }

  private async describe(rows: Row[]) {
    const overrides = await this.prisma.gradingModeConfig.findMany({
      where: { assignmentId: { not: null } },
      distinct: ["assignmentId"],
      select: { assignmentId: true },
    });
    let latest: Row | undefined;
    for (const row of rows) {
      if (!latest || row.updatedAt > latest.updatedAt) latest = row;
    }
    return {
      engine: engineOf(rows),
      assignmentOverrides: overrides.length,
      updatedBy: latest?.updatedBy ?? null,
      updatedAt: latest?.updatedAt.toISOString() ?? null,
    };
  }

  private globalRows(client: Pick<PrismaService, "gradingModeConfig">) {
    return client.gradingModeConfig.findMany({
      where: {
        assignmentId: null,
        questionType: { in: [...V3_QUESTION_TYPES] as QuestionType[] },
      },
      select: rowSelect,
    });
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @V3Route({ response: engineResponseSchema })
  async get() {
    const described = await this.describe(await this.globalRows(this.prisma));
    this.log.info("grading.engine.read", { engine: described.engine });
    return described;
  }

  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @V3Route({ response: engineResponseSchema })
  async put(
    @V3Principal() admin: Principal,
    @Body(new ZodPipe(putEngineSchema)) body: PutEngineBody,
  ) {
    const mode = ENGINE_MODE[body.engine];
    try {
      const { before, after } = await this.prisma.$transaction(async (tx) => {
        const existing = await this.globalRows(tx);
        for (const questionType of V3_QUESTION_TYPES) {
          const updated = await tx.gradingModeConfig.updateMany({
            where: { questionType, assignmentId: null },
            data: { mode, updatedBy: admin.userId },
          });
          if (updated.count === 0) {
            await tx.gradingModeConfig.create({
              data: {
                questionType,
                assignmentId: null,
                mode,
                updatedBy: admin.userId,
              },
            });
          }
        }
        return { before: existing, after: await this.globalRows(tx) };
      });
      this.modes.invalidate();
      this.log.info("grading.engine.updated", {
        before: modesByType(before),
        after: modesByType(after),
      });
      return this.describe(after);
    } catch (error) {
      // Two first writes raced on the unique index; the caller retries.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw V3Error.conflict("concurrent_update");
      }
      throw error;
    }
  }
}
