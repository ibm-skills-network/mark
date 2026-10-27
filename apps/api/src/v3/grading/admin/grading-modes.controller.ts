import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Prisma, QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import { z } from "zod";
import { AdminGuard } from "../../../auth/guards/admin.guard";
import type { UserSessionRequest } from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
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

const rowSelect = {
  id: true,
  questionType: true,
  assignmentId: true,
  mode: true,
  effort: true,
  updatedBy: true,
  updatedAt: true,
} as const;

/**
 * Runtime switches for v3 grading. AdminGuard rejects every non-admin
 * session; writes are throttled and logged with before and after.
 */
@ApiTags("Admin v3 grading modes")
@ApiBearerAuth()
@UseGuards(AdminGuard, ThrottlerGuard)
@Controller({ path: "admin/grading-modes", version: "3" })
export class GradingModesController {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modes: GradingModeService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: GradingModesController.name });
  }

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(@Req() request: UserSessionRequest) {
    const rows = await this.prisma.gradingModeConfig.findMany({
      select: rowSelect,
      orderBy: [{ questionType: "asc" }, { assignmentId: "asc" }],
    });
    this.logger.info("grading.modes.list", {
      admin: request.userSession?.userId,
      count: rows.length,
    });
    return {
      rows,
      shadowAllowed: process.env.GRADING_SHADOW_ALLOWED === "true",
    };
  }

  @Put()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async put(@Req() request: UserSessionRequest, @Body() body: unknown) {
    const admin = request.userSession?.userId;
    const parsed = putGradingModeSchema.safeParse(body);
    if (!parsed.success) {
      this.logger.warn("grading.modes.put_rejected", {
        admin,
        reason: "invalid_body",
        issues: parsed.error.issues.map((issue) => issue.path.join(".")),
      });
      throw new BadRequestException("Invalid request");
    }
    const { questionType, assignmentId, mode, effort } = parsed.data;
    if (!admin) {
      // AdminGuard sets this; a missing value means the guard was bypassed.
      throw new BadRequestException("Invalid request");
    }

    if (assignmentId !== null) {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { id: true },
      });
      if (!assignment) {
        this.logger.warn("grading.modes.put_rejected", {
          admin,
          reason: "unknown_assignment",
          assignmentId,
        });
        throw new BadRequestException("Invalid request");
      }
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
              data: { mode, effort, updatedBy: admin },
              select: rowSelect,
            })
          : await tx.gradingModeConfig.create({
              data: {
                questionType,
                assignmentId,
                mode,
                effort,
                updatedBy: admin,
              },
              select: rowSelect,
            });
        return { before: existing, after: saved };
      });
      this.modes.invalidate();
      this.logger.info("grading.modes.updated", {
        admin,
        questionType,
        assignmentId,
        before: before
          ? { id: before.id, mode: before.mode, effort: before.effort }
          : null,
        after: { id: after.id, mode: after.mode, effort: after.effort },
      });
      return after;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        this.logger.warn("grading.modes.put_conflict", {
          admin,
          questionType,
          assignmentId,
        });
        throw new ConflictException("Concurrent update; try again");
      }
      this.logger.error("grading.modes.put_failed", {
        admin,
        questionType,
        assignmentId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
