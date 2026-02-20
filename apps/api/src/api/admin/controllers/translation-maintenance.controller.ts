import {
  BadRequestException,
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
import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from "class-validator";
import { getAllLanguageCodes } from "src/api/assignment/attempt/helper/languages";
import { JobStatusServiceV2 } from "src/api/assignment/v2/services/job-status.service";
import { TranslationService } from "src/api/assignment/v2/services/translation.service";
import { PrismaService } from "src/database/prisma.service";

class MissingTranslationsRequestDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  assignmentIds?: number[];

  @IsOptional()
  @IsBoolean()
  includeAll?: boolean;

  @IsOptional()
  @IsBoolean()
  includeNames?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

class FixMissingTranslationsRequestDto {
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
  assignmentId?: number;

  @IsOptional()
  @IsBoolean()
  includeAll?: boolean;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  languageCodes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxMissing?: number;
}

type MissingItem = {
  questionId: number;
  variantId: number | null;
  missingLanguages: string[];
  text?: string;
  choices?: unknown;
};

type AssignmentScanResult = {
  assignmentId: number;
  assignmentName: string;
  missingAssignmentLanguages: string[];
  missingItems: MissingItem[];
};

type MissingAssignmentSummary = {
  assignmentId: number;
  assignmentName: string;
};

type QuestionToTranslate = {
  questionId: number;
  text: string;
  choices: unknown;
  variants: Array<{ id: number; variantContent: string; choices: unknown }>;
};

const normalizeLang = (code: string) => code.toLowerCase();

@ApiTags("Admin")
@ApiBearerAuth()
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
@Controller({
  path: "admin/translations",
  version: "1",
})
export class TranslationMaintenanceController {
  private readonly logger = new Logger(TranslationMaintenanceController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly translationService: TranslationService,
    private readonly jobStatusService: JobStatusServiceV2,
  ) {}

  @Post("missing/find")
  @ApiOperation({ summary: "Find assignments with missing translations" })
  async findMissingTranslations(
    @Body() body: MissingTranslationsRequestDto,
  ): Promise<{
    success: true;
    data: number[] | MissingAssignmentSummary[];
  }> {
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const includeAll = Boolean(body.includeAll);
    const includeNames = Boolean(body.includeNames);

    const assignments = await this.resolveAssignmentsToScan(
      body.assignmentIds,
      includeAll,
      body.limit,
    );

    const results: MissingAssignmentSummary[] = [];
    const assignmentIds: number[] = [];

    for (const assignment of assignments) {
      const scanResult = await this.scanAssignment(
        assignment.id,
        supportedLanguages,
        includeAll,
        false,
      );

      if (!scanResult) continue;

      if (
        scanResult.missingAssignmentLanguages.length > 0 ||
        scanResult.missingItems.length > 0
      ) {
        assignmentIds.push(scanResult.assignmentId);
        if (includeNames) {
          results.push({
            assignmentId: scanResult.assignmentId,
            assignmentName: scanResult.assignmentName,
          });
        }
      }
    }

    return { success: true, data: includeNames ? results : assignmentIds };
  }

  @Post("missing/fix")
  @ApiBody({
    type: FixMissingTranslationsRequestDto,
    examples: {
      default: {
        summary: "Translate active-version questions for assignments",
        value: {
          assignmentIds: [123, 456],
          languageCodes: ["en", "es", "fr"],
          dryRun: false,
          maxMissing: 100,
        },
      },
    },
  })
  @ApiOperation({
    summary:
      "Fix missing translations for assignments (async — returns a job ID to poll for status)",
  })
  async fixMissingTranslations(
    @Body() body: FixMissingTranslationsRequestDto,
  ): Promise<{
    success: true;
    jobId: number;
    message: string;
    assignmentIds: number[];
    dryRun: boolean;
  }> {
    const assignmentIds =
      body.assignmentIds && body.assignmentIds.length > 0
        ? body.assignmentIds
        : body.assignmentId
          ? [body.assignmentId]
          : [];

    if (assignmentIds.length === 0) {
      throw new BadRequestException(
        "Provide assignmentId or assignmentIds to run translations",
      );
    }

    const job = await this.jobStatusService.createPublishJob(
      assignmentIds[0],
      "admin",
    );

    void this.runTranslationsInBackground(job.id, assignmentIds, body);

    return {
      success: true,
      jobId: job.id,
      message: `Translation job started for ${assignmentIds.length} assignment(s). Poll GET /api/v1/admin/translations/missing/fix/status/${job.id} for progress.`,
      assignmentIds,
      dryRun: Boolean(body.dryRun),
    };
  }

  @Get("missing/fix/status/:jobId")
  @ApiOperation({ summary: "Check the status of a fix-translations job" })
  async getFixJobStatus(@Param("jobId", ParseIntPipe) jobId: number): Promise<{
    success: true;
    jobId: number;
    status: string;
    progress: string;
    percentage: number | null;
    result: unknown;
    createdAt: Date;
    updatedAt: Date;
  }> {
    const job = await this.prisma.publishJob.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new NotFoundException(`Translation job ${jobId} not found`);
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
      progress: job.progress,
      percentage: job.percentage ?? null,
      result,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Background job
  // ---------------------------------------------------------------------------

  private async runTranslationsInBackground(
    jobId: number,
    assignmentIds: number[],
    body: FixMissingTranslationsRequestDto,
  ): Promise<void> {
    const supportedLanguages = getAllLanguageCodes() ?? ["en"];
    const supportedLanguagesByNormalized = new Map(
      supportedLanguages.map((lang) => [normalizeLang(lang), lang]),
    );

    // Build the ordered, deduplicated list of target languages
    const requestedLanguages = (body.languageCodes ?? [])
      .map((lang) => normalizeLang(lang))
      .filter((lang) => supportedLanguagesByNormalized.has(lang))
      .map((lang) => supportedLanguagesByNormalized.get(lang) ?? lang);
    const targetLanguages =
      requestedLanguages.length > 0 ? requestedLanguages : supportedLanguages;
    const translateAllLanguages =
      targetLanguages.length === supportedLanguages.length;

    const dryRun = Boolean(body.dryRun);
    const maxMissing = body.maxMissing;

    const results: Array<{
      assignmentId: number;
      processedTranslations: number;
      questionsTranslated: number;
      error?: string;
    }> = [];

    let processedTranslations = 0;
    let remainingTranslations: number | null =
      typeof maxMissing === "number" ? maxMissing : null;

    try {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: `Starting translations for ${assignmentIds.length} assignment(s)`,
        percentage: 0,
      });

      for (let index = 0; index < assignmentIds.length; index++) {
        const assignmentId = assignmentIds[index];
        const progressPct = Math.floor((index / assignmentIds.length) * 90);

        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Translating assignment ${assignmentId} (${index + 1}/${assignmentIds.length})`,
          percentage: progressPct,
        });

        try {
          const {
            processedTranslations: assignmentProcessed,
            questionsTranslated,
            remainingTranslations: nextRemaining,
          } = await this.translateAssignmentQuestions({
            assignmentId,
            targetLanguages,
            translateAllLanguages,
            dryRun,
            remainingTranslations,
          });

          processedTranslations += assignmentProcessed;
          remainingTranslations = nextRemaining;

          results.push({
            assignmentId,
            processedTranslations: assignmentProcessed,
            questionsTranslated,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            `Failed to translate assignment ${assignmentId}: ${errorMessage}`,
          );
          results.push({
            assignmentId,
            processedTranslations: 0,
            questionsTranslated: 0,
            error: errorMessage,
          });
        }

        if (remainingTranslations !== null && remainingTranslations <= 0) {
          break;
        }
      }

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress: `Completed: ${processedTranslations} translations across ${results.length} assignment(s)`,
        percentage: 100,
        result: {
          processedTranslations,
          assignmentsProcessed: results.length,
          dryRun,
          results,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Translation job ${jobId} failed: ${errorMessage}`);

      await this.jobStatusService
        .updateJobStatus(jobId, {
          status: "Failed",
          progress: `Job failed: ${errorMessage.slice(0, 200)}`,
          percentage: 0,
          result: { error: errorMessage, partialResults: results },
        })
        .catch((updateError) => {
          this.logger.error(
            `Failed to update job ${jobId} failure status: ${String(updateError)}`,
          );
        });
    }
  }

  // ---------------------------------------------------------------------------
  // Core translation logic
  // ---------------------------------------------------------------------------

  private async translateAssignmentQuestions({
    assignmentId,
    targetLanguages,
    translateAllLanguages,
    dryRun,
    remainingTranslations,
  }: {
    assignmentId: number;
    targetLanguages: string[];
    translateAllLanguages: boolean;
    dryRun: boolean;
    remainingTranslations: number | null;
  }): Promise<{
    processedTranslations: number;
    questionsTranslated: number;
    remainingTranslations: number | null;
  }> {
    // -------------------------------------------------------------------------
    // 1. Load assignment with its ACTIVE (current) version only.
    //    assignment.currentVersion is the published, non-draft active version.
    //    We deliberately do NOT fall back to the most recently created version
    //    because that could be an in-progress draft.
    // -------------------------------------------------------------------------
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        currentVersion: {
          include: { questionVersions: true },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with id ${assignmentId} not found`,
      );
    }

    // -------------------------------------------------------------------------
    // 2. Translate assignment metadata (name, introduction, instructions,
    //    gradingCriteriaOverview) — scoped to targetLanguages.
    // -------------------------------------------------------------------------
    if (!dryRun) {
      await (translateAllLanguages
        ? this.translationService.translateAssignment(assignmentId)
        : this.translationService.translateAssignmentForLanguages(
            assignmentId,
            targetLanguages,
          ));
    }

    // -------------------------------------------------------------------------
    // 3. Build the list of questions to translate.
    //
    //    Priority: active version's questionVersions → base questions.
    //
    //    QuestionVersion holds a snapshot of the question at publish time, so
    //    `qv.question` and `qv.choices` are the authoritative text/choices for
    //    that version.  Variants live on the base Question record (there is no
    //    per-version variant snapshot), so we still fetch them from Question.
    //
    //    Questions whose questionId is null (added directly inside a version
    //    without a base Question record) cannot be stored in Translation (which
    //    requires a Question FK), so they are skipped with a warning.
    // -------------------------------------------------------------------------
    const activeVersion = assignment.currentVersion;
    const questionVersions = activeVersion?.questionVersions ?? [];

    let questionsToTranslate: QuestionToTranslate[] = [];

    if (questionVersions.length > 0) {
      this.logger.log(
        `Assignment ${assignmentId}: translating ${questionVersions.length} questions from active version ${activeVersion?.id}`,
      );

      // Collect questionIds that have a base Question record (nullable FK)
      const questionIds = [
        ...new Set(
          questionVersions
            .map((qv) => qv.questionId)
            .filter((id): id is number => id !== null && id !== undefined),
        ),
      ];

      // Log any version-only questions that cannot be translated
      const versionOnlyCount = questionVersions.length - questionIds.length;
      if (versionOnlyCount > 0) {
        this.logger.warn(
          `Assignment ${assignmentId}: ${versionOnlyCount} question version(s) have no base Question record and will be skipped (questionId is null — cannot store Translation FK).`,
        );
      }

      // Fetch base questions for variant data
      const baseQuestions =
        questionIds.length > 0
          ? await this.prisma.question.findMany({
              where: { id: { in: questionIds } },
              select: {
                id: true,
                variants: {
                  where: { isDeleted: false },
                  select: {
                    id: true,
                    variantContent: true,
                    choices: true,
                  },
                },
              },
            })
          : [];

      const questionById = new Map(baseQuestions.map((q) => [q.id, q]));

      questionsToTranslate = questionVersions
        .filter(
          (qv): qv is typeof qv & { questionId: number } =>
            qv.questionId !== null && qv.questionId !== undefined,
        )
        .map((qv) => {
          const baseQuestion = questionById.get(qv.questionId);

          if (!baseQuestion) {
            this.logger.warn(
              `Assignment ${assignmentId}: base Question record ${qv.questionId} not found — variants will be skipped.`,
            );
          }

          return {
            questionId: qv.questionId,
            text: qv.question ?? "",
            choices: qv.choices,
            variants: baseQuestion?.variants ?? [],
          };
        });
    } else {
      // No active version — use base Question records directly
      this.logger.log(
        `Assignment ${assignmentId}: no active version found — translating base questions.`,
      );

      const questions = await this.prisma.question.findMany({
        where: { assignmentId, isDeleted: false },
        select: {
          id: true,
          question: true,
          choices: true,
          variants: {
            where: { isDeleted: false },
            select: {
              id: true,
              variantContent: true,
              choices: true,
            },
          },
        },
      });

      questionsToTranslate = questions.map((q) => ({
        questionId: q.id,
        text: q.question ?? "",
        choices: q.choices,
        variants: q.variants,
      }));
    }

    // -------------------------------------------------------------------------
    // 4. Translate each question and its variants using a single unified path.
    //
    //    Both the "translate everything" (no maxMissing) and the "limited
    //    budget" (maxMissing) cases use the same helper so that targetLanguages
    //    is always respected and the code path is not duplicated.
    // -------------------------------------------------------------------------
    let processedTranslations = 0;
    let remaining = remainingTranslations;

    for (const question of questionsToTranslate) {
      // Translate question text + choices
      const { processed: qProcessed, next: qNext } =
        await this.translateOneItem({
          assignmentId,
          questionId: question.questionId,
          variantId: null,
          text: question.text,
          choices: question.choices,
          targetLanguages,
          dryRun,
          remaining,
        });
      processedTranslations += qProcessed;
      remaining = qNext;

      if (remaining !== null && remaining <= 0) break;

      // Translate each variant's content + choices
      for (const variant of question.variants) {
        const { processed: vProcessed, next: vNext } =
          await this.translateOneItem({
            assignmentId,
            questionId: question.questionId,
            variantId: variant.id,
            text: variant.variantContent,
            choices: variant.choices,
            targetLanguages,
            dryRun,
            remaining,
          });
        processedTranslations += vProcessed;
        remaining = vNext;

        if (remaining !== null && remaining <= 0) break;
      }

      if (remaining !== null && remaining <= 0) break;
    }

    return {
      processedTranslations,
      questionsTranslated: questionsToTranslate.length,
      remainingTranslations: remaining,
    };
  }

  /**
   * Translate a single question or variant item to the requested target
   * languages and update the remaining budget.
   *
   * - Detects the source language of the text.
   * - Deletes any existing Translation rows for the target languages before
   *   writing, so stale/incorrect translations are replaced rather than
   *   accumulated (Translation has no unique constraint).
   * - Honours the `remaining` budget: only translates up to `remaining`
   *   languages when a limit is set, or all target languages when unlimited.
   */
  private async translateOneItem(options: {
    assignmentId: number;
    questionId: number;
    variantId: number | null;
    text: string;
    choices: unknown;
    targetLanguages: string[];
    dryRun: boolean;
    remaining: number | null;
  }): Promise<{ processed: number; next: number | null }> {
    const {
      assignmentId,
      questionId,
      variantId,
      text,
      choices,
      targetLanguages,
      dryRun,
      remaining,
    } = options;

    if (!text || text.trim().length === 0) {
      return { processed: 0, next: remaining };
    }

    const currentRemaining = remaining === null ? null : Math.max(0, remaining);

    if (currentRemaining !== null && currentRemaining <= 0) {
      return { processed: 0, next: 0 };
    }

    const languagesToProcess =
      currentRemaining === null
        ? targetLanguages
        : targetLanguages.slice(0, currentRemaining);

    if (languagesToProcess.length === 0) {
      return { processed: 0, next: currentRemaining };
    }

    if (!dryRun) {
      const sourceLanguage = await this.translationService.detectLanguage(
        text,
        assignmentId,
      );

      // Remove stale Translation rows for these languages before writing fresh
      // ones. Without this, each call would append a new row (no unique
      // constraint on the table) and learners would see the oldest entry.
      await this.prisma.translation.deleteMany({
        where: {
          questionId,
          variantId,
          languageCode: { in: languagesToProcess },
        },
      });

      await this.translationService.translateContentToLanguages(
        assignmentId,
        questionId,
        variantId,
        text,
        choices ?? null,
        sourceLanguage,
        languagesToProcess,
      );
    }

    const processed = languagesToProcess.length;
    const next = remaining === null ? null : remaining - processed;

    return { processed, next };
  }

  // ---------------------------------------------------------------------------
  // Find-missing helpers
  // ---------------------------------------------------------------------------

  private async resolveAssignmentsToScan(
    assignmentIds: number[] | undefined,
    includeAll: boolean,
    limit?: number,
  ): Promise<Array<{ id: number; name: string }>> {
    if (assignmentIds && assignmentIds.length > 0) {
      return this.prisma.assignment.findMany({
        where: { id: { in: assignmentIds } },
        select: { id: true, name: true },
        orderBy: { id: "asc" },
      });
    }

    return this.prisma.assignment.findMany({
      where: includeAll
        ? {}
        : {
            published: true,
            currentVersion: {
              isActive: true,
              isDraft: false,
            },
          },
      select: { id: true, name: true },
      take: limit,
      orderBy: { id: "asc" },
    });
  }

  private async scanAssignment(
    assignmentId: number,
    supportedLanguages: string[],
    includeAll: boolean,
    includeText: boolean,
  ): Promise<AssignmentScanResult | null> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, name: true },
    });

    if (!assignment) return null;

    const assignmentTranslations =
      await this.prisma.assignmentTranslation.findMany({
        where: { assignmentId },
        select: { languageCode: true },
      });

    const assignmentLangs = new Set(
      assignmentTranslations.map((t) => normalizeLang(t.languageCode)),
    );
    const missingAssignmentLanguages = supportedLanguages.filter(
      (lang) => !assignmentLangs.has(normalizeLang(lang)),
    );

    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        ...(includeAll ? {} : { isDeleted: false }),
      },
      select: {
        id: true,
        question: true,
        choices: true,
        translations: {
          select: { languageCode: true, variantId: true },
        },
        variants: {
          where: includeAll ? {} : { isDeleted: false },
          select: { id: true, variantContent: true, choices: true },
        },
      },
    });

    const missingItems: MissingItem[] = [];

    for (const question of questions) {
      const languageMap = new Map<string, Set<string>>();

      for (const translation of question.translations) {
        const key = translation.variantId
          ? `variant-${translation.variantId}`
          : `question-${question.id}`;
        if (!languageMap.has(key)) {
          languageMap.set(key, new Set<string>());
        }
        languageMap.get(key)?.add(normalizeLang(translation.languageCode));
      }

      const questionKey = `question-${question.id}`;
      const questionLangs = languageMap.get(questionKey) ?? new Set<string>();
      const missingQuestionLangs = supportedLanguages.filter(
        (lang) => !questionLangs.has(normalizeLang(lang)),
      );

      if (missingQuestionLangs.length > 0) {
        missingItems.push({
          questionId: question.id,
          variantId: null,
          missingLanguages: missingQuestionLangs,
          text: includeText ? question.question : undefined,
          choices: includeText ? question.choices : undefined,
        });
      }

      for (const variant of question.variants) {
        const variantKey = `variant-${variant.id}`;
        const variantLangs = languageMap.get(variantKey) ?? new Set<string>();
        const missingVariantLangs = supportedLanguages.filter(
          (lang) => !variantLangs.has(normalizeLang(lang)),
        );

        if (missingVariantLangs.length > 0) {
          missingItems.push({
            questionId: question.id,
            variantId: variant.id,
            missingLanguages: missingVariantLangs,
            text: includeText ? variant.variantContent : undefined,
            choices: includeText ? variant.choices : undefined,
          });
        }
      }
    }

    return {
      assignmentId: assignment.id,
      assignmentName: assignment.name,
      missingAssignmentLanguages,
      missingItems,
    };
  }
}
