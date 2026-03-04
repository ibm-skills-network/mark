import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorrectAnswerVisibility } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from "class-validator";
import { JobStatusServiceV2 } from "src/api/assignment/v2/services/job-status.service";
import { PrismaService } from "src/database/prisma.service";

class ApplyLevelStandardsRequestDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignmentIds?: number[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  batchSize?: number;
}

type LevelStandardsUpdates = {
  attemptsBeforeCoolDown: number;
  retakeAttemptCoolDownMinutes: number;
  showAssignmentScore: boolean;
  showQuestionScore: boolean;
  showSubmissionFeedback: boolean;
  showQuestions: boolean;
  correctAnswerVisibility: CorrectAnswerVisibility;
};

type LevelStandards = {
  level: number;
  updates: LevelStandardsUpdates;
};

type LevelStandardsError = {
  assignmentId: number;
  name: string;
  error: string;
};

type LevelStandardsJobResult = {
  scanned: number;
  matched: number;
  updated: number;
  dryRun: boolean;
  batchSize: number;
  errors: LevelStandardsError[];
};

// Matches: "Level 1", "Level  2", "L1", "L 3" (uppercase only, digits 1-4)
// Does NOT match: "level 1", "l2", "Level blah 2", "Level-2", "Level5"
const LEVEL_NAME_REGEX = /\b(?:Level\s*|L)\s*([1-4])\b/;

const getLevelFromName = (name?: string | null): number | null => {
  if (!name) return null;

  const match = LEVEL_NAME_REGEX.exec(name);
  if (!match) return null;

  const level = Number.parseInt(match[1], 10);
  if (Number.isNaN(level) || level < 1 || level > 4) return null;

  return level;
};

const getStandardsForLevel = (level: number): LevelStandardsUpdates => {
  const baseRetakePolicy = {
    attemptsBeforeCoolDown: 1,
    retakeAttemptCoolDownMinutes: 5,
  };

  if (level === 3) {
    return {
      ...baseRetakePolicy,
      showAssignmentScore: true,
      showQuestionScore: false,
      showSubmissionFeedback: false,
      showQuestions: false,
      correctAnswerVisibility: CorrectAnswerVisibility.NEVER,
    };
  }

  // Levels 1, 2, 4
  return {
    ...baseRetakePolicy,
    showAssignmentScore: true,
    showQuestionScore: true,
    showSubmissionFeedback: false,
    showQuestions: true,
    correctAnswerVisibility: CorrectAnswerVisibility.ON_PASS,
  };
};

const getLevelStandardsFromName = (
  name?: string | null
): LevelStandards | null => {
  const level = getLevelFromName(name);
  if (level === null) return null;

  return {
    level,
    updates: getStandardsForLevel(level),
  };
};

@ApiTags("Admin")
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
)
@Controller({
  path: "admin/assignments/level-standards",
  version: "1",
})
export class AssignmentLevelStandardsController {
  private readonly logger = new Logger(AssignmentLevelStandardsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobStatusService: JobStatusServiceV2
  ) {}

  @Post("apply")
  @ApiOperation({
    summary:
      "Apply level-based standards to assignments matching Level X or LX pattern in name (async job)",
  })
  @ApiBody({
    type: ApplyLevelStandardsRequestDto,
    examples: {
      default: {
        summary: "Start an async job to apply standards",
        value: {
          assignmentIds: [123, 456],
          dryRun: false,
          batchSize: 5,
        },
      },
    },
  })
  async applyLevelStandards(
    @Body() body: ApplyLevelStandardsRequestDto
  ): Promise<{
    success: true;
    jobId: number;
    message: string;
    assignmentIds?: number[];
    dryRun: boolean;
    batchSize: number;
  }> {
    const dryRun = body.dryRun ?? false;
    const batchSize = body.batchSize ?? 5;
    const assignmentIds =
      body.assignmentIds && body.assignmentIds.length > 0
        ? body.assignmentIds
        : undefined;

    const requestedAssignmentId = assignmentIds?.[0];
    const fallbackAssignment =
      requestedAssignmentId === undefined
        ? await this.prisma.assignment.findFirst({
            select: { id: true },
            orderBy: { id: "asc" },
          })
        : undefined;
    const jobAssignmentId = requestedAssignmentId ?? fallbackAssignment?.id;

    if (!jobAssignmentId) {
      throw new NotFoundException(
        "No assignments found to run level standards job"
      );
    }

    // Reuse the same publishJob infra used by translation backfills.
    const job = await this.jobStatusService.createPublishJob(
      jobAssignmentId,
      "admin"
    );

    void this.runLevelStandardsInBackground(job.id, {
      assignmentIds,
      dryRun,
      batchSize,
    });

    const message = assignmentIds
      ? `Level standards job started for ${assignmentIds.length} assignment(s). Poll GET /api/v1/admin/assignments/level-standards/apply/status/${job.id} for progress.`
      : `Level standards job started for all assignments. Poll GET /api/v1/admin/assignments/level-standards/apply/status/${job.id} for progress.`;

    return {
      success: true,
      jobId: job.id,
      message,
      assignmentIds,
      dryRun,
      batchSize,
    };
  }

  @Get("apply/status/:jobId")
  @ApiOperation({ summary: "Check the status of a level-standards apply job" })
  async getApplyJobStatus(
    @Param("jobId", ParseIntPipe) jobId: number
  ): Promise<{
    success: true;
    jobId: number;
    status: string;
    progress: string | null;
    percentage: number | null;
    result: unknown;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const job = await this.prisma.publishJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Level standards job ${jobId} not found`);
    }

    let result: unknown = null;
    if (job.result) {
      try {
        result =
          typeof job.result === "string"
            ? (JSON.parse(job.result) as unknown)
            : job.result;
      } catch {
        result = job.result;
      }
    }

    return {
      success: true,
      jobId: job.id,
      status: job.status,
      progress: job.progress ?? null,
      percentage: job.percentage ?? null,
      result,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  private async runLevelStandardsInBackground(
    jobId: number,
    options: {
      assignmentIds?: number[];
      dryRun: boolean;
      batchSize: number;
    }
  ): Promise<void> {
    const { assignmentIds, dryRun, batchSize } = options;

    let scanned = 0;
    let matched = 0;
    let updated = 0;
    const errors: LevelStandardsError[] = [];

    const processBatch = async (
      assignments: Array<{
        id: number;
        name: string;
        currentVersionId: number | null;
      }>
    ): Promise<void> => {
      scanned += assignments.length;

      const matches: Array<{
        assignmentId: number;
        name: string;
        level: number;
        currentVersionId: number | null;
      }> = [];

      for (const assignment of assignments) {
        const standards = getLevelStandardsFromName(assignment.name);
        if (!standards) continue;

        matches.push({
          assignmentId: assignment.id,
          name: assignment.name,
          level: standards.level,
          currentVersionId: assignment.currentVersionId ?? null,
        });
      }

      if (matches.length === 0) return;
      matched += matches.length;

      if (dryRun) return;

      const level3AssignmentIds: number[] = [];
      const otherAssignmentIds: number[] = [];
      const level3VersionIds: number[] = [];
      const otherVersionIds: number[] = [];

      for (const match of matches) {
        if (match.level === 3) {
          level3AssignmentIds.push(match.assignmentId);
          if (match.currentVersionId) {
            level3VersionIds.push(match.currentVersionId);
          }
        } else {
          otherAssignmentIds.push(match.assignmentId);
          if (match.currentVersionId) {
            otherVersionIds.push(match.currentVersionId);
          }
        }
      }

      const uniqueLevel3VersionIds = [...new Set(level3VersionIds)];
      const uniqueOtherVersionIds = [...new Set(otherVersionIds)];

      try {
        const operations = [];

        if (level3AssignmentIds.length > 0) {
          const updates = getStandardsForLevel(3);
          operations.push(
            this.prisma.assignment.updateMany({
              where: { id: { in: level3AssignmentIds } },
              data: updates,
            })
          );
          if (uniqueLevel3VersionIds.length > 0) {
            operations.push(
              this.prisma.assignmentVersion.updateMany({
                where: { id: { in: uniqueLevel3VersionIds } },
                data: updates,
              })
            );
          }
        }

        if (otherAssignmentIds.length > 0) {
          const updates = getStandardsForLevel(1);
          operations.push(
            this.prisma.assignment.updateMany({
              where: { id: { in: otherAssignmentIds } },
              data: updates,
            })
          );
          if (uniqueOtherVersionIds.length > 0) {
            operations.push(
              this.prisma.assignmentVersion.updateMany({
                where: { id: { in: uniqueOtherVersionIds } },
                data: updates,
              })
            );
          }
        }

        await this.prisma.$transaction(operations);
        updated += matches.length;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        for (const match of matches) {
          errors.push({
            assignmentId: match.assignmentId,
            name: match.name,
            error: message,
          });
        }
      }
    };

    try {
      const totalToProcess =
        assignmentIds?.length ?? (await this.prisma.assignment.count());

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: assignmentIds
          ? `Starting level standards job for ${assignmentIds.length} assignment(s)`
          : "Starting level standards job for all assignments",
        percentage: 0,
      });

      if (assignmentIds) {
        let processed = 0;

        for (let index = 0; index < assignmentIds.length; index += batchSize) {
          const batchIds = assignmentIds.slice(index, index + batchSize);
          const assignments = await this.prisma.assignment.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, name: true, currentVersionId: true },
          });

          await processBatch(assignments);

          processed += batchIds.length;
          const pct =
            totalToProcess === 0
              ? 0
              : Math.floor((processed / totalToProcess) * 100);

          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Processed ${processed}/${totalToProcess} (scanned ${scanned}, matched ${matched}${
              dryRun ? ", dry run" : `, updated ${updated}`
            })`,
            percentage: pct,
          });
        }
      } else {
        let lastId = 0;

        for (;;) {
          const assignments = await this.prisma.assignment.findMany({
            where: { id: { gt: lastId } },
            orderBy: { id: "asc" },
            take: batchSize,
            select: { id: true, name: true, currentVersionId: true },
          });

          if (assignments.length === 0) break;

          await processBatch(assignments);
          lastId = assignments.at(-1).id;

          const pct =
            totalToProcess === 0
              ? 0
              : Math.floor((scanned / totalToProcess) * 100);

          await this.jobStatusService.updateJobStatus(jobId, {
            status: "In Progress",
            progress: `Processed ${scanned}/${totalToProcess} (matched ${matched}${
              dryRun ? ", dry run" : `, updated ${updated}`
            })`,
            percentage: pct,
          });
        }
      }

      const result: LevelStandardsJobResult = {
        scanned,
        matched,
        updated: dryRun ? 0 : updated,
        dryRun,
        batchSize,
        errors,
      };

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress: `Completed: scanned ${scanned}, matched ${matched}${
          dryRun ? "" : `, updated ${updated}`
        }`,
        percentage: 100,
        result,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Level standards job ${jobId} failed: ${errorMessage}`);

      const result: LevelStandardsJobResult = {
        scanned,
        matched,
        updated: dryRun ? 0 : updated,
        dryRun,
        batchSize,
        errors,
      };

      await this.jobStatusService
        .updateJobStatus(jobId, {
          status: "Failed",
          progress: `Job failed: ${errorMessage.slice(0, 200)}`,
          percentage: 0,
          result: { ...result, error: errorMessage },
        })
        .catch((updateError) => {
          this.logger.error(
            `Failed to update job ${jobId} failure status: ${String(
              updateError
            )}`
          );
        });
    }
  }
}
