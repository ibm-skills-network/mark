import { Body, Get, Put } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Prisma, QuestionType } from "@prisma/client";
import { z } from "zod";
import { PrismaService } from "../../../database/prisma.service";
import { UseAdmin } from "../../core/admin.guard";
import { V3Error } from "../../core/errors";
import type { Principal } from "../../core/principal";
import { UseV3Throttle } from "../../core/throttle.guard";
import { V3Principal } from "../../core/principal.guard";
import { V3Controller, V3Route } from "../../core/v3-controller.decorator";
import { V3Logger } from "../../core/v3-logger";
import { ZodPipe } from "../../core/zod.pipe";
import { gradingEffortSchema } from "../contracts";
import {
  GradingModeService,
  gradingModeSchema,
  V3_QUESTION_TYPES,
} from "../mode";

const v3QuestionTypes = [...V3_QUESTION_TYPES] as [
  QuestionType,
  ...QuestionType[],
];

export const putGradingModeSchema = z.strictObject({
  questionType: z.enum(v3QuestionTypes),
  assignmentId: z.number().int().positive().max(2_147_483_647).nullable(),
  mode: gradingModeSchema,
  effort: gradingEffortSchema.nullable(),
});
export type PutGradingModeBody = z.infer<typeof putGradingModeSchema>;

const modeRowSchema = z.object({
  id: z.number(),
  questionType: z.enum(v3QuestionTypes),
  assignmentId: z.number().nullable(),
  mode: gradingModeSchema,
  effort: gradingEffortSchema.nullable(),
  updatedBy: z.string(),
  updatedAt: z.string(),
});

const rowSelect = {
  id: true,
  questionType: true,
  assignmentId: true,
  mode: true,
  effort: true,
  updatedBy: true,
  updatedAt: true,
} as const;

type Row = Prisma.GradingModeConfigGetPayload<{ select: typeof rowSelect }>;

function toResponse(row: Row): z.input<typeof modeRowSchema> {
  return { ...row, updatedAt: row.updatedAt.toISOString() } as z.input<
    typeof modeRowSchema
  >;
}

/**
 * Runtime switches for v3 grading at /api/v3/admin/grading-modes. Admin
 * sessions only; writes are throttled and logged with before and after.
 */
@V3Controller("admin/grading-modes")
// Decorators apply bottom-up: the admin guard runs first, then the limit.
@UseV3Throttle()
@UseAdmin()
export class GradingModesController {
  private readonly log: V3Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modes: GradingModeService,
    logger: V3Logger,
  ) {
    this.log = logger.child("grading.modes");
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @V3Route({
    response: z.object({
      rows: z.array(modeRowSchema),
      shadowAllowed: z.boolean(),
    }),
  })
  async list() {
    const rows = await this.prisma.gradingModeConfig.findMany({
      select: rowSelect,
      orderBy: [{ questionType: "asc" }, { assignmentId: "asc" }],
    });
    this.log.info("grading.modes.listed", { count: rows.length });
    return {
      rows: rows.map((row) => toResponse(row)),
      shadowAllowed: process.env.GRADING_SHADOW_ALLOWED === "true",
    };
  }

  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @V3Route({ response: modeRowSchema })
  async put(
    @V3Principal() admin: Principal,
    @Body(new ZodPipe(putGradingModeSchema)) body: PutGradingModeBody,
  ) {
    const { questionType, assignmentId, mode, effort } = body;

    if (assignmentId !== null) {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true },
      });
      if (!assignment) throw V3Error.badRequest("unknown_assignment");
    }

    try {
      const { before, after } = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.gradingModeConfig.findFirst({
          where: { questionType, assignmentId },
          select: rowSelect,
        });
        const saved = existing
          ? await tx.gradingModeConfig.update({
              where: { id: existing.id },
              data: { mode, effort, updatedBy: admin.userId },
              select: rowSelect,
            })
          : await tx.gradingModeConfig.create({
              data: {
                questionType,
                assignmentId,
                mode,
                effort,
                updatedBy: admin.userId,
              },
              select: rowSelect,
            });
        return { before: existing, after: saved };
      });
      this.modes.invalidate();
      this.log.info("grading.modes.updated", {
        question_type: questionType,
        target_assignment_id: assignmentId,
        before: before
          ? { id: before.id, mode: before.mode, effort: before.effort }
          : null,
        after: { id: after.id, mode: after.mode, effort: after.effort },
      });
      return toResponse(after);
    } catch (error) {
      // Two first writes for the same switch raced on the unique index; the
      // other one won, so the caller retries against the saved row.
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
