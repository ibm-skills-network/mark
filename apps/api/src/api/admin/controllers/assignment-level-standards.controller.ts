import {
  Body,
  Controller,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CorrectAnswerVisibility, Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Min,
} from "class-validator";
import { AdminGuard } from "src/auth/guards/admin.guard";
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

type LevelStandardsResult = {
  assignmentId: number;
  name: string;
  level: number;
  updated: boolean;
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
@UseGuards(AdminGuard)
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
  constructor(private readonly prisma: PrismaService) {}

  @Post("apply")
  @ApiOperation({
    summary:
      "Apply level-based standards to assignments matching Level X or LX pattern in name",
  })
  @ApiBody({
    type: ApplyLevelStandardsRequestDto,
    examples: {
      default: {
        summary: "Apply standards to specific assignments",
        value: {
          assignmentIds: [123, 456],
          dryRun: false,
        },
      },
    },
  })
  async applyLevelStandards(
    @Body() body: ApplyLevelStandardsRequestDto
  ): Promise<{
    success: true;
    dryRun: boolean;
    matched: number;
    updated: number;
    results: LevelStandardsResult[];
    errors: Array<{ assignmentId: number; name: string; error: string }>;
  }> {
    const dryRun = body.dryRun ?? false;
    const assignmentIds = body.assignmentIds?.length
      ? body.assignmentIds
      : undefined;

    const assignments = await this.prisma.assignment.findMany({
      where: assignmentIds ? { id: { in: assignmentIds } } : undefined,
      select: { id: true, name: true, currentVersionId: true },
    });

    const results: LevelStandardsResult[] = [];
    const errors: Array<{ assignmentId: number; name: string; error: string }> =
      [];
    let updated = 0;

    for (const assignment of assignments) {
      const standards = getLevelStandardsFromName(assignment.name);
      if (!standards) continue;

      if (!dryRun) {
        try {
          const updates = standards.updates;
          const operations: Prisma.PrismaPromise<unknown>[] = [
            this.prisma.assignment.update({
              where: { id: assignment.id },
              data: updates,
            }),
          ];
          if (assignment.currentVersionId) {
            operations.push(
              this.prisma.assignmentVersion.update({
                where: { id: assignment.currentVersionId },
                data: updates,
              })
            );
          }
          await this.prisma.$transaction(operations);
          updated += 1;
        } catch (error) {
          errors.push({
            assignmentId: assignment.id,
            name: assignment.name,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          continue;
        }
      }

      results.push({
        assignmentId: assignment.id,
        name: assignment.name,
        level: standards.level,
        updated: !dryRun,
      });
    }

    return {
      success: true,
      dryRun,
      matched: results.length,
      updated,
      results,
      errors,
    };
  }
}
