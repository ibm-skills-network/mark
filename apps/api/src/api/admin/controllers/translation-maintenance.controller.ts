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
  Max,
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional()
  @IsBoolean()
  onlyUntranslated?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  languageCodes?: string[];
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

class SweepTranslationsRequestDto {
  /**
   * How many assignments to translate per batch (default: 5, max: 20).
   * Smaller values reduce DB and LLM load between pauses.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  batchSize?: number;

  /**
   * Hard limit on the total number of batches to run. Useful for capping
   * a single sweep invocation while ensuring subsequent calls pick up where
   * this one left off. Omit to run until all assignments are covered.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxBatches?: number;

  /** Restrict translation to these language codes only. Defaults to all 23. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  languageCodes?: string[];

  /** Scan and report what would be translated without writing to the DB. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /**
   * Milliseconds to pause between consecutive batches (default: 2000).
   * Increase to reduce load on the LLM provider and production DB.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delayBetweenBatchesMs?: number;

  /**
   * When true, also scans unpublished assignments and assignments without an
   * active non-draft version. Defaults to false (published only).
   */
  @IsOptional()
  @IsBoolean()
  includeAll?: boolean;
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
  hasAnyTranslations: boolean;
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

type BaseQuestionForTranslation = {
  id: number;
  question: string;
  choices: unknown;
  variants: Array<{ id: number; variantContent: string; choices: unknown }>;
};

const normalizeLang = (code: string) => code.toLowerCase();
const normalizeQuestionText = (text: string | null | undefined) =>
  (text ?? "").trim().toLowerCase().replaceAll(/\s+/g, " ");

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
    pagination?: {
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
      hasNextPage: boolean;
      hasPreviousPage: boolean;
    };
  }> {
    const allSupportedLanguages = getAllLanguageCodes() ?? ["en"];
    const supportedLanguagesByNormalized = new Map(
      allSupportedLanguages.map((lang) => [normalizeLang(lang), lang]),
    );
    const requestedLanguages = (body.languageCodes ?? [])
      .map((lang) => normalizeLang(lang))
      .filter((lang) => supportedLanguagesByNormalized.has(lang))
      .map((lang) => supportedLanguagesByNormalized.get(lang) ?? lang);

    if (
      (body.languageCodes?.length ?? 0) > 0 &&
      requestedLanguages.length === 0
    ) {
      throw new BadRequestException(
        "No valid languageCodes provided for missing translation scan",
      );
    }

    const supportedLanguages =
      requestedLanguages.length > 0
        ? requestedLanguages
        : allSupportedLanguages;
    const includeAll = Boolean(body.includeAll);
    const includeNames = Boolean(body.includeNames);
    const onlyUntranslated = Boolean(body.onlyUntranslated);
    const shouldPaginate =
      body.page !== undefined || body.pageSize !== undefined;
    const page = body.page ?? 1;
    const pageSize = body.pageSize ?? 50;

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
        if (onlyUntranslated && scanResult.hasAnyTranslations) {
          continue;
        }
        assignmentIds.push(scanResult.assignmentId);
        if (includeNames) {
          results.push({
            assignmentId: scanResult.assignmentId,
            assignmentName: scanResult.assignmentName,
          });
        }
      }
    }

    if (!shouldPaginate) {
      return { success: true, data: includeNames ? results : assignmentIds };
    }

    const totalItems = includeNames ? results.length : assignmentIds.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
    const currentPage = totalPages === 0 ? 1 : Math.min(page, totalPages);
    const offset = (currentPage - 1) * pageSize;

    const pagedData = includeNames
      ? results.slice(offset, offset + pageSize)
      : assignmentIds.slice(offset, offset + pageSize);

    return {
      success: true,
      data: pagedData,
      pagination: {
        page: currentPage,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPreviousPage: currentPage > 1,
      },
    };
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

  @Post("sweep")
  @ApiOperation({
    summary:
      "Auto-sweep all assignments (newest → oldest), detecting and fixing missing translations in batches (async — returns a job ID to poll for status)",
  })
  async sweepMissingTranslations(
    @Body() body: SweepTranslationsRequestDto,
  ): Promise<{ success: true; jobId: number; message: string }> {
    // publishJob.assignmentId has no FK constraint; 0 is used as a sentinel
    // for sweep jobs that are not tied to a single assignment.
    const job = await this.jobStatusService.createPublishJob(0, "admin");
    void this.runSweepInBackground(job.id, body);
    return {
      success: true,
      jobId: job.id,
      message: `Translation sweep started. Poll GET /api/v1/admin/translations/missing/fix/status/${job.id} for progress.`,
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

      // Fetch all base questions for resilient mapping. Some active-version
      // questionVersions can have null or stale questionId values.
      const baseQuestions: BaseQuestionForTranslation[] =
        await this.prisma.question.findMany({
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

      const baseQuestionById = new Map(baseQuestions.map((q) => [q.id, q]));
      const baseQuestionIdByDisplayOrder = new Map<number, number>();
      const baseQuestionsByText = new Map<
        string,
        Array<(typeof baseQuestions)[number]>
      >();

      for (const [index, questionId] of (
        assignment.questionOrder ?? []
      ).entries()) {
        if (typeof questionId === "number") {
          baseQuestionIdByDisplayOrder.set(index + 1, questionId);
        }
      }

      for (const question of baseQuestions) {
        const normalizedText = normalizeQuestionText(question.question);
        if (normalizedText) {
          const byText = baseQuestionsByText.get(normalizedText) ?? [];
          byText.push(question);
          baseQuestionsByText.set(normalizedText, byText);
        }
      }

      questionsToTranslate = questionVersions.flatMap((qv) => {
        let baseQuestion: (typeof baseQuestions)[number] | undefined;

        if (qv.questionId !== null && qv.questionId !== undefined) {
          baseQuestion = baseQuestionById.get(qv.questionId);
        }

        if (!baseQuestion && typeof qv.displayOrder === "number") {
          const byDisplayId = baseQuestionIdByDisplayOrder.get(qv.displayOrder);
          if (typeof byDisplayId === "number") {
            baseQuestion = baseQuestionById.get(byDisplayId);
          }
        }

        if (!baseQuestion) {
          const normalizedVersionText = normalizeQuestionText(qv.question);
          const byText = normalizedVersionText
            ? baseQuestionsByText.get(normalizedVersionText)
            : undefined;
          if (byText?.length === 1) {
            baseQuestion = byText[0];
          }
        }

        if (!baseQuestion) {
          this.logger.warn(
            `Assignment ${assignmentId}: could not map active question version ${qv.id} to a base question (questionId=${qv.questionId ?? "null"}). Skipping this question version.`,
          );
          return [];
        }

        return [
          {
            questionId: baseQuestion.id,
            text:
              qv.question && qv.question.trim().length > 0
                ? qv.question
                : (baseQuestion.question ?? ""),
            choices: qv.choices ?? baseQuestion.choices,
            variants: baseQuestion.variants ?? [],
          },
        ];
      });

      if (questionsToTranslate.length === 0 && baseQuestions.length > 0) {
        this.logger.warn(
          `Assignment ${assignmentId}: no active question versions could be mapped; falling back to base questions for translation.`,
        );

        questionsToTranslate = baseQuestions.map((q) => ({
          questionId: q.id,
          text: q.question ?? "",
          choices: q.choices,
          variants: q.variants,
        }));
      }
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
      let qProcessed = 0;
      let qNext = remaining;

      try {
        const questionResult = await this.translateOneItem({
          assignmentId,
          questionId: question.questionId,
          variantId: null,
          text: question.text,
          choices: question.choices,
          targetLanguages,
          dryRun,
          remaining,
        });
        qProcessed = questionResult.processed;
        qNext = questionResult.next;
      } catch (error) {
        this.logger.warn(
          `Assignment ${assignmentId}: failed to translate question ${question.questionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }

      processedTranslations += qProcessed;
      remaining = qNext;

      if (remaining !== null && remaining <= 0) break;

      // Translate each variant's content + choices
      for (const variant of question.variants) {
        let vProcessed = 0;
        let vNext = remaining;

        try {
          const variantResult = await this.translateOneItem({
            assignmentId,
            questionId: question.questionId,
            variantId: variant.id,
            text: variant.variantContent,
            choices: variant.choices,
            targetLanguages,
            dryRun,
            remaining,
          });
          vProcessed = variantResult.processed;
          vNext = variantResult.next;
        } catch (error) {
          this.logger.warn(
            `Assignment ${assignmentId}: failed to translate variant ${variant.id} for question ${question.questionId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }

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
  // Sweep background job
  // ---------------------------------------------------------------------------

  /**
   * Background worker for the sweep endpoint. Repeatedly calls
   * findNextBatchForSweep() to discover assignments that need translation,
   * translates each batch, then pauses before the next batch. The cursor
   * advances so that no assignment is ever scanned twice within a single run.
   */
  private async runSweepInBackground(
    jobId: number,
    body: SweepTranslationsRequestDto,
  ): Promise<void> {
    const batchSize = body.batchSize ?? 5;
    const maxBatches = body.maxBatches ?? null;
    const delayMs = body.delayBetweenBatchesMs ?? 2000;
    const dryRun = Boolean(body.dryRun);
    const includeAll = Boolean(body.includeAll);

    const allSupportedLanguages = getAllLanguageCodes() ?? ["en"];
    const supportedLanguagesByNormalized = new Map(
      allSupportedLanguages.map((lang) => [normalizeLang(lang), lang]),
    );
    const requestedLanguages = (body.languageCodes ?? [])
      .map((lang) => normalizeLang(lang))
      .filter((lang) => supportedLanguagesByNormalized.has(lang))
      .map((lang) => supportedLanguagesByNormalized.get(lang) ?? lang);
    const targetLanguages =
      requestedLanguages.length > 0
        ? requestedLanguages
        : allSupportedLanguages;
    const translateAllLanguages =
      targetLanguages.length === allSupportedLanguages.length;

    // Cursor starts at the newest assignments (no id filter on first pass),
    // then moves downward (`id < cursor`) after each scan window.
    let cursor: number | null = null;
    let batchCount = 0;
    let totalProcessed = 0;
    let totalAssignmentsFixed = 0;
    const batchResults: Array<{
      batchNumber: number;
      assignmentIds: number[];
      processedTranslations: number;
    }> = [];

    try {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Sweep started — scanning from newest to oldest assignments",
        percentage: 0,
      });

      for (;;) {
        const { batch, nextCursor } = await this.findNextBatchForSweep(
          cursor,
          batchSize,
          targetLanguages,
          includeAll,
        );

        if (nextCursor === null) {
          // Scanned past all assignments — nothing more to find.
          this.logger.log(
            `Sweep job ${jobId}: no more assignments to scan. Sweep complete.`,
          );
          break;
        }

        cursor = nextCursor;

        if (batch.length === 0) {
          // This window had no assignments needing work; advance the cursor
          // and continue scanning downward.
          continue;
        }

        batchCount++;
        const batchAssignmentIds = batch.map((a) => a.id);

        this.logger.log(
          `Sweep job ${jobId}: batch ${batchCount} — ${batch.length} assignment(s) [${batchAssignmentIds.join(", ")}]`,
        );

        const progressPct = maxBatches
          ? Math.min(Math.floor((batchCount / maxBatches) * 90), 90)
          : Math.min(batchCount * 5, 90);

        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: `Batch ${batchCount}: translating ${batch.length} assignment(s) [${batchAssignmentIds.join(", ")}]`,
          percentage: progressPct,
        });

        let batchProcessed = 0;
        for (const assignment of batch) {
          try {
            const { processedTranslations } =
              await this.translateAssignmentQuestions({
                assignmentId: assignment.id,
                targetLanguages,
                translateAllLanguages,
                dryRun,
                remainingTranslations: null,
              });
            batchProcessed += processedTranslations;
            totalProcessed += processedTranslations;
            totalAssignmentsFixed++;
          } catch (error) {
            this.logger.error(
              `Sweep job ${jobId}: failed assignment ${assignment.id}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        }

        batchResults.push({
          batchNumber: batchCount,
          assignmentIds: batchAssignmentIds,
          processedTranslations: batchProcessed,
        });

        if (maxBatches !== null && batchCount >= maxBatches) {
          this.logger.log(
            `Sweep job ${jobId}: reached maxBatches limit (${maxBatches}). Stopping.`,
          );
          break;
        }

        // Throttle between batches to avoid hammering the LLM API and DB.
        if (delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Completed",
        progress: `Sweep complete: ${totalAssignmentsFixed} assignment(s) fixed, ${totalProcessed} translation(s) across ${batchCount} batch(es)`,
        percentage: 100,
        result: {
          totalAssignmentsFixed,
          totalProcessed,
          batchCount,
          dryRun,
          batches: batchResults,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Sweep job ${jobId} failed: ${errorMessage}`);

      await this.jobStatusService
        .updateJobStatus(jobId, {
          status: "Failed",
          progress: `Sweep failed: ${errorMessage.slice(0, 200)}`,
          percentage: 0,
          result: {
            error: errorMessage,
            totalAssignmentsFixed,
            totalProcessed,
            batchCount,
            partialBatches: batchResults,
          },
        })
        .catch((updateError) => {
          this.logger.error(
            `Failed to update sweep job ${jobId} failure status: ${String(updateError)}`,
          );
        });
    }
  }

  /**
   * Finds the next batch of assignments that need translation.
   *
   * Uses a two-phase scan over a sliding window of assignments:
   *
   * Phase 1 (fast) — single bulk `groupBy` query:
   *   `AssignmentTranslation` has `@@unique([assignmentId, languageCode])`, so
   *   the count equals the number of distinct language codes. Any assignment
   *   with count < totalLanguages is definitely missing translations.
   *
   * Phase 2 (slow) — `scanAssignment` per assignment:
   *   Assignments that pass the fast check may still have missing question-level
   *   translations. These are detected via the existing full scan helper.
   *
   * Cursor semantics (`id: { lt: cursor }` once cursor is set):
   *   - If there are more needy assignments in the window than `batchSize`, the
   *     cursor is set to `needy[batchSize].id + 1` so the next call picks up
   *     exactly from the (batchSize+1)th needy assignment — no needy assignment
   *     is ever skipped between calls.
   *   - Otherwise the cursor advances to `min(window IDs)`, moving past the
   *     entire scanned window before the next call.
   *   - Returns `null` when the window is empty (all assignments scanned).
   */
  private async findNextBatchForSweep(
    cursor: number | null,
    batchSize: number,
    targetLanguages: string[],
    includeAll: boolean,
  ): Promise<{
    batch: Array<{ id: number; name: string }>;
    nextCursor: number | null;
  }> {
    const SCAN_WINDOW = Math.max(batchSize * 3, 15);
    const totalLangCount = targetLanguages.length;

    // Step 1: load a window of candidate assignments (newest-first, paginated).
    const window = await this.prisma.assignment.findMany({
      where: {
        ...(cursor === null ? {} : { id: { lt: cursor } }),
        ...(includeAll
          ? {}
          : {
              published: true,
              currentVersion: {
                isActive: true,
                isDraft: false,
              },
            }),
      },
      select: { id: true, name: true },
      orderBy: { id: "desc" },
      take: SCAN_WINDOW,
    });

    if (window.length === 0) {
      return { batch: [], nextCursor: null };
    }

    const windowIds = window.map((a) => a.id);

    // Step 2: single bulk query — assignment-level translation counts.
    // With @@unique([assignmentId, languageCode]), count == distinct languages.
    const translationCounts = await this.prisma.assignmentTranslation.groupBy({
      by: ["assignmentId"],
      where: { assignmentId: { in: windowIds } },
      _count: { languageCode: true },
    });
    const countByAssignmentId = new Map(
      translationCounts.map((c) => [c.assignmentId, c._count.languageCode]),
    );

    // Step 3: classify every assignment in the window.
    const needy: Array<{ id: number; name: string }> = [];

    for (const assignment of window) {
      const assignmentLangCount = countByAssignmentId.get(assignment.id) ?? 0;

      if (assignmentLangCount < totalLangCount) {
        // Fast path: assignment-level translations are definitely incomplete.
        needy.push(assignment);
      } else {
        // Slow path: assignment-level translations appear complete; check
        // question-level translations to be sure.
        const scanResult = await this.scanAssignment(
          assignment.id,
          targetLanguages,
          includeAll,
          false,
        );
        if (
          scanResult &&
          (scanResult.missingAssignmentLanguages.length > 0 ||
            scanResult.missingItems.length > 0)
        ) {
          needy.push(assignment);
        }
      }
    }

    // Step 4: take the first `batchSize` needy assignments for this iteration.
    const batch = needy.slice(0, batchSize);

    // Step 5: compute the cursor for the next call.
    // If more needy assignments remain in the window, jump to just above the
    // next one so it is included in the next scan (`id: { lt: cursor }` is
    // exclusive). Otherwise move past the entire window.
    const nextCursor =
      needy.length > batchSize
        ? needy[batchSize].id + 1
        : Math.min(...windowIds);

    return { batch, nextCursor };
  }

  // ---------------------------------------------------------------------------
  // Question-version → base-question mapping
  // ---------------------------------------------------------------------------

  /**
   * Resolves question-version records to base Question IDs using three
   * strategies (in priority order):
   *
   *   1. Direct `questionId` FK on the QuestionVersion.
   *   2. Display-order alignment with `assignment.questionOrder`.
   *   3. Normalized text matching (only when there is exactly one match).
   *
   * When none of the question versions can be mapped but base questions exist,
   * falls back to returning ALL base question IDs (mirrors the fallback in
   * translateAssignmentQuestions).
   *
   * Both `scanAssignment` and `translateAssignmentQuestions` must agree on
   * which questions belong to a version; this shared helper guarantees parity.
   */
  private async resolveActiveVersionQuestionIds(
    assignmentId: number,
    questionVersions: Array<{
      questionId: number | null;
      displayOrder: number | null;
      question: string | null;
    }>,
    questionOrder: unknown,
  ): Promise<number[]> {
    if (questionVersions.length === 0) {
      return [];
    }

    const baseQuestions = await this.prisma.question.findMany({
      where: { assignmentId, isDeleted: false },
      select: { id: true, question: true },
    });

    if (baseQuestions.length === 0) {
      return [];
    }

    const baseQuestionById = new Map(baseQuestions.map((q) => [q.id, q]));

    // Display-order → base question ID map from assignment.questionOrder
    const baseQuestionIdByDisplayOrder = new Map<number, number>();
    if (Array.isArray(questionOrder)) {
      for (const [index, qId] of questionOrder.entries()) {
        if (typeof qId === "number") {
          baseQuestionIdByDisplayOrder.set(index + 1, qId);
        }
      }
    }

    // Normalized text → base questions map
    const baseQuestionsByText = new Map<
      string,
      Array<(typeof baseQuestions)[number]>
    >();
    for (const question of baseQuestions) {
      const normalizedText = normalizeQuestionText(question.question);
      if (normalizedText) {
        const byText = baseQuestionsByText.get(normalizedText) ?? [];
        byText.push(question);
        baseQuestionsByText.set(normalizedText, byText);
      }
    }

    const resolvedIds = new Set<number>();

    for (const qv of questionVersions) {
      let baseQuestion: (typeof baseQuestions)[number] | undefined;

      // Strategy 1: direct FK
      if (qv.questionId !== null && qv.questionId !== undefined) {
        baseQuestion = baseQuestionById.get(qv.questionId);
      }

      // Strategy 2: display-order alignment
      if (!baseQuestion && typeof qv.displayOrder === "number") {
        const byDisplayId = baseQuestionIdByDisplayOrder.get(qv.displayOrder);
        if (typeof byDisplayId === "number") {
          baseQuestion = baseQuestionById.get(byDisplayId);
        }
      }

      // Strategy 3: normalized text match (only unambiguous)
      if (!baseQuestion) {
        const normalizedVersionText = normalizeQuestionText(qv.question);
        const byText = normalizedVersionText
          ? baseQuestionsByText.get(normalizedVersionText)
          : undefined;
        if (byText?.length === 1) {
          baseQuestion = byText[0];
        }
      }

      if (baseQuestion) {
        resolvedIds.add(baseQuestion.id);
      }
    }

    // Fallback: if no versions could be mapped, use all base questions
    if (resolvedIds.size === 0) {
      return baseQuestions.map((q) => q.id);
    }

    return [...resolvedIds];
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
        orderBy: { id: "desc" },
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
      orderBy: { id: "desc" },
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
      select: {
        id: true,
        name: true,
        questionOrder: true,
        currentVersion: {
          select: {
            id: true,
            questionVersions: {
              select: {
                questionId: true,
                displayOrder: true,
                question: true,
              },
            },
          },
        },
      },
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

    const questionVersions = assignment.currentVersion?.questionVersions ?? [];
    const shouldRestrictToCurrentVersion =
      !includeAll && questionVersions.length > 0;

    const currentVersionQuestionIds = includeAll
      ? []
      : await this.resolveActiveVersionQuestionIds(
          assignmentId,
          questionVersions,
          assignment.questionOrder,
        );

    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        ...(shouldRestrictToCurrentVersion
          ? {
              id: {
                in: currentVersionQuestionIds,
              },
            }
          : {}),
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

    const hasAnyTranslations =
      assignmentTranslations.length > 0 ||
      questions.some((question) => question.translations.length > 0);

    return {
      assignmentId: assignment.id,
      assignmentName: assignment.name,
      missingAssignmentLanguages,
      missingItems,
      hasAnyTranslations,
    };
  }
}
