import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import IORedis from "ioredis";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { seedInflightLanguages } from "src/api/assignment/attempt/translation-state-redis";
import { AttemptAccessCacheService } from "src/api/attempt/services/attempt-access-cache.service";
import { UserSession } from "src/auth/interfaces/user.session.interface";
import { PrismaService } from "src/database/prisma.service";
import { JOB_NAMES, JOB_QUEUE_NAMES } from "src/job-queue/job-queue.constants";
import { JobQueueService } from "src/job-queue/job-queue.service";
import { TranslateMetaJobPayload } from "src/job-queue/job-queue.types";
import { createRedisConnection } from "src/job-queue/redis.connection";
import { Logger } from "winston";
import { getAllLanguageCodes } from "../../attempt/helper/languages";
import { BaseAssignmentResponseDto } from "../../dto/base.assignment.response.dto";
import {
  AssignmentResponseDto,
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "../../dto/get.assignment.response.dto";
import { ReplaceAssignmentRequestDto } from "../../dto/replace.assignment.request.dto";
import { UpdateAssignmentRequestDto } from "../../dto/update.assignment.request.dto";
import {
  Choice,
  QuestionDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
} from "../../dto/update.questions.request.dto";
import { applyQuestionOrder } from "../../utils/question-order.util";
import { AssignmentRepository } from "../repositories/assignment.repository";
import { JobStatusServiceV2 } from "./job-status.service";
import type {
  PerJobTranslationEntry,
  PublishJobResult,
} from "./publish-job-result.types";
import { QuestionService } from "./question.service";
import { TranslationService } from "./translation.service";
import {
  VersionManagementService,
  VersionSummary,
} from "./version-management.service";

// Publish-job translation-progress poll loop constants. After the
// DB-writes-done boundary, runPublishJob stays alive on mark-jobs and polls
// the per-publish status hash every second — each tick aggregates the
// per-job entries the translation workers HSET and surfaces them on the
// SSE stream via JobStatusUpdate.result. The hard timeout caps loop
// runtime; on timeout the publish job marks itself Completed anyway and
// outstanding translations fall through to the existing admin recovery
// endpoint.
const PUBLISH_TRANSLATION_POLL_INTERVAL_MS = 1000;
const PUBLISH_TRANSLATION_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const buildPublishHashKey = (parentJobId: string): string =>
  `mark:publish:${parentJobId}:translations`;

/**
 * Service for managing assignment operations
 */
@Injectable()
export class AssignmentServiceV2 implements OnModuleDestroy {
  private logger: Logger;
  // Dedicated IORedis connection for the per-assignment in-flight language
  // SET. The publish flow SADDs all supported language codes into this set
  // before fanning out translation jobs; the worker SREMs each language as
  // it terminates. Keeping a single instance per service mirrors the
  // existing JobQueueService Redis pattern and avoids reconnect storms.
  private readonly translationStateRedis: IORedis | undefined;

  constructor(
    private readonly assignmentRepository: AssignmentRepository,
    private readonly questionService: QuestionService,
    private readonly translationService: TranslationService,
    private readonly versionManagementService: VersionManagementService,
    private readonly jobStatusService: JobStatusServiceV2,
    private readonly jobQueueService: JobQueueService,
    private readonly prisma: PrismaService,
    private readonly attemptAccessCache: AttemptAccessCacheService,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: "AssignmentServiceV2" });
    this.translationStateRedis = this.tryCreateTranslationStateRedis();
  }

  // Wrap createRedisConnection() so missing REDIS_URL (or boot-time Redis
  // failure) degrades gracefully instead of bringing down DI. Status sites
  // become no-ops; the publish poll loop falls back to the hard timeout.
  private tryCreateTranslationStateRedis(): IORedis | undefined {
    try {
      const client = createRedisConnection();
      client.on("error", (error) => {
        this.logger.warn(
          `Translation status Redis error (status tracking disabled): ${error.message}`,
        );
      });
      return client;
    } catch (error) {
      this.logger.warn(
        `Translation status Redis unavailable — status tracking disabled: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.translationStateRedis?.quit().catch(() => null);
  }

  /**
   * Get an assignment by ID with possible translation
   *
   * @param assignmentId - The ID of the assignment
   * @param userSession - The user session details
   * @param languageCode - Optional language code for translation
   * @returns Assignment data tailored to the user's role
   */

  async getAssignment(
    assignmentId: number,
    userSession: UserSession,
    languageCode?: string,
  ): Promise<GetAssignmentResponseDto | LearnerGetAssignmentResponseDto> {
    const assignment = await this.assignmentRepository.findById(
      assignmentId,
      userSession,
    );

    if (languageCode) {
      await this.translationService.applyTranslationsToAssignment(
        assignment,
        languageCode,
      );
    }

    return assignment;
  }

  /**
   * List all assignments available to the user
   *
   * @param userSession - The user session details
   * @returns Array of assignment summaries
   */

  async listAssignments(
    userSession: UserSession,
  ): Promise<AssignmentResponseDto[]> {
    return this.assignmentRepository.findAllForUser(userSession);
  }

  /**
   * Update an assignment with new properties
   *
   * @param id - The assignment ID
   * @param updateDto - The data to update
   * @returns Success response with the updated assignment ID
   */

  async updateAssignment(
    id: number,
    updateDto: UpdateAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const existingAssignment = await this.assignmentRepository.findById(id);

    const shouldTranslate = this.shouldTranslateAssignment(
      existingAssignment,
      updateDto,
    );

    const result = await this.assignmentRepository.update(id, updateDto);

    if (shouldTranslate) {
      // Translation work moved off the synchronous PATCH path. Seed the
      // per-assignment in-flight refcount hash with one worker per
      // language so a learner hitting the GET attempt endpoint during the
      // brief enqueue-to-worker window sees translationStatus "pending"
      // instead of "unavailable". The single meta worker decrements each
      // language counter as it terminates; the TTL fallback covers the
      // case where the worker dies before cleanup.
      const supportedLanguageCodes = getAllLanguageCodes();
      if (supportedLanguageCodes.length > 0 && this.translationStateRedis) {
        await seedInflightLanguages(
          this.translationStateRedis,
          id,
          supportedLanguageCodes,
          1,
        );
      }

      // Assignment-meta translation (name / introduction / instructions /
      // grading-criteria) runs as its own retryable BullMQ job on the
      // dedicated translations queue. The PATCH response no longer blocks
      // on LLM work. No parentJobId is passed — this code path has no
      // parent publish job, and the worker tolerates the absent
      // per-publish hash key.
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
        JOB_NAMES.TRANSLATE_META,
        {
          assignmentId: id,
        } satisfies TranslateMetaJobPayload,
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
      );
      this.logger.info("publish.translation.job.enqueued", {
        assignmentId: id,
        kind: "meta",
        id,
      });
    }

    if (updateDto.published) {
      await this.questionService.updateQuestionGradingContext(id);
    }

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Replace an entire assignment
   *
   * @param id - The assignment ID
   * @param replaceDto - The new assignment data
   * @returns Success response with the updated assignment ID
   */
  async replaceAssignment(
    id: number,
    replaceDto: ReplaceAssignmentRequestDto,
  ): Promise<BaseAssignmentResponseDto> {
    const result = await this.assignmentRepository.replace(id, replaceDto);

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Get available languages for an assignment
   *
   * @param assignmentId - The assignment ID
   * @returns Array of language codes
   */
  async getAvailableLanguages(assignmentId: number): Promise<string[]> {
    return this.translationService.getAvailableLanguages(assignmentId);
  }

  /**
   * Publish an assignment with updated questions
   *
   * @param assignmentId - The assignment ID
   * @param updateDto - The updated assignment data with questions
   * @param userId - The ID of the user making the request
   * @returns Job tracking information
   */
  /**
   * Reconnect helper. Returns the in-flight publish job for an
   * assignment so a refreshed client can re-subscribe to the SSE
   * stream without starting a new publish. Reuses the deterministic
   * jobId scheme already used by publishAssignment for dedup.
   */
  async findActivePublishJob(
    assignmentId: number,
  ): Promise<{ id: string; state: string } | null> {
    const deterministicJobId = `publish:v2:${assignmentId}`;
    return this.jobQueueService.findActiveJob(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      deterministicJobId,
    );
  }

  async publishAssignment(
    assignmentId: number,
    updateDto: UpdateAssignmentQuestionsDto,
    userId: string,
  ): Promise<{ jobId: string; message: string }> {
    this.logger.info(
      `📦 PUBLISH REQUEST: Received updateDto with versionNumber: ${updateDto.versionNumber}, versionDescription: ${updateDto.versionDescription}`,
    );

    // Deterministic per-assignment publish job id. BullMQ silently no-ops a
    // duplicate `add` when {jobId} matches an in-flight job, so this gives us
    // queue-layer dedup without a separate lock. Combined with
    // removeOnComplete/removeOnFail below, the dedup window ends as soon as
    // the previous publish terminates.
    const deterministicJobId = `publish:v2:${assignmentId}`;

    const existing = await this.jobQueueService.findActiveJob(
      JOB_QUEUE_NAMES.ASSIGNMENT_V2,
      deterministicJobId,
    );
    if (existing) {
      this.logger.warn(
        `Publish dedup hit: assignment ${assignmentId} already has an active publish job (${existing.state})`,
        {
          assignmentId,
          jobId: existing.id,
          state: existing.state,
          requestedByUserId: userId,
        },
      );
      return {
        jobId: existing.id,
        message: "Publishing already in progress",
      };
    }

    const job = await this.jobStatusService.createPublishJob(
      assignmentId,
      userId,
      { reservedId: deterministicJobId },
    );

    try {
      await this.jobQueueService.enqueue(
        JOB_QUEUE_NAMES.ASSIGNMENT_V2,
        JOB_NAMES.ASSIGNMENT_V2_PUBLISH,
        {
          assignmentId,
          jobId: job.id,
          updateDto,
          userId,
        },
        {
          jobId: job.id,
          // Single attempt only. Stall recovery is disabled at the worker
          // (maxStalledCount=0) and a deterministic jobId already dedups
          // re-enqueues, so the default attempts:3 from the queue service
          // would only re-introduce the concurrent-execution race we
          // already eliminated. If publish fails, the user retries by hand.
          attempts: 1,
          // End the dedup window as soon as the job terminates (success or
          // failure). Without this, completed/failed jobs linger in BullMQ
          // history and a deterministic id would pin to the stale record.
          // findActiveJob filters out terminal states, but removing the
          // history entries also prevents them from lingering as overhead.
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.jobStatusService.updateJobStatus(job.id, {
        status: "Failed",
        progress: `Failed to enqueue publish job: ${errorMessage}`,
      });
      throw error;
    }

    return {
      jobId: job.id,
      message: "Publishing started",
    };
  }
  async runPublishJob(
    jobId: string,
    assignmentId: number,
    updateDto: UpdateAssignmentQuestionsDto,
    userId: string,
  ): Promise<void> {
    // Wall-clock anchor for the publish-complete telemetry below. Captures
    // DB-writes-done latency — the user-visible metric the publish hot path
    // is budgeted against (target: 30 s p95 for a 50-question publish).
    const publishStartedAt = Date.now();

    // Wipe any per-question entries left over from a previous publish
    // under the same deterministic jobId. Normally the poll loop DELs
    // this hash on exit, but if the previous publish crashed or its
    // cleanup didn't fire, markPending's HSETNX would no-op on the
    // stale fields and the new publish would inherit Done/Failed rows
    // for questions that don't even exist in this run.
    try {
      await this.translationStateRedis?.del(buildPublishHashKey(jobId));
    } catch (delError) {
      this.logger.warn("publish.translations.reset.failed", {
        assignmentId,
        jobId,
        error: delError instanceof Error ? delError.message : String(delError),
      });
    }

    try {
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Updating assignment settings",
        percentage: 5,
      });

      const existingAssignment =
        await this.assignmentRepository.findById(assignmentId);

      const assignmentTranslatableFieldsChanged =
        this.haveTranslatableAssignmentFieldsChanged(
          existingAssignment,
          updateDto,
        );

      await this.assignmentRepository.update(assignmentId, {
        introduction: updateDto.introduction,
        instructions: updateDto.instructions,
        gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
        numAttempts: updateDto.numAttempts,
        attemptsBeforeCoolDown: updateDto.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes: updateDto.retakeAttemptCoolDownMinutes,
        passingGrade: updateDto.passingGrade,
        displayOrder: updateDto.displayOrder,
        graded: updateDto.graded,
        questionDisplay: updateDto.questionDisplay,
        allotedTimeMinutes: updateDto.allotedTimeMinutes,
        published: updateDto.published,
        showAssignmentScore: updateDto.showAssignmentScore,
        showQuestionScore: updateDto.showQuestionScore,
        showSubmissionFeedback: updateDto.showSubmissionFeedback,
        correctAnswerVisibility: updateDto.correctAnswerVisibility,
        timeEstimateMinutes: updateDto.timeEstimateMinutes,
        showQuestions: updateDto.showQuestions,
        numberOfQuestionsPerAttempt: updateDto.numberOfQuestionsPerAttempt,
        questionControls: updateDto.questionControls,
        requireAllQuestions: updateDto.requireAllQuestions,
        optionalQuestionIds: updateDto.optionalQuestionIds,
      });

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Assignment settings updated",
        percentage: 10,
      });

      try {
        await this.prisma.assignmentAuthor.upsert({
          where: {
            assignmentId_userId: {
              assignmentId,
              userId,
            },
          },
          update: {},
          create: {
            assignmentId,
            userId,
          },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to store assignment author: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
      }

      let questionContentChanged = false;
      let frontendToBackendIdMap = new Map<number, number>();
      let perQuestionTranslationJobsEnqueued = 0;

      if (updateDto.questions && updateDto.questions.length > 0) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: "Checking for question content changes",
          percentage: 15,
        });

        const existingQuestions =
          await this.questionService.getQuestionsForAssignment(assignmentId);

        questionContentChanged = this.haveQuestionContentsChanged(
          existingQuestions,
          updateDto.questions,
        );

        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress: questionContentChanged
            ? `Processing ${updateDto.questions.length} questions with content changes`
            : "Processing questions (metadata only)",
          percentage: 20,
        });

        const processResult =
          await this.questionService.processQuestionsForPublishing(
            assignmentId,
            updateDto.questions,
            jobId,
            async (childProgress: number) => {
              const mappedProgress = 30 + (childProgress * 50) / 100;
              await this.jobStatusService.updateJobStatus(jobId, {
                status: "In Progress",
                progress: `Processing questions: ${childProgress}% complete`,
                percentage: Math.floor(mappedProgress),
              });
            },
          );
        frontendToBackendIdMap = processResult.idMap;
        perQuestionTranslationJobsEnqueued =
          processResult.translationJobsEnqueued;
      }

      const existingTranslationCount =
        await this.prisma.assignmentTranslation.count({
          where: { assignmentId },
        });
      const shouldTranslateAssignment =
        assignmentTranslatableFieldsChanged ||
        questionContentChanged ||
        existingTranslationCount === 0;

      // A republish that touches neither translatable assignment fields nor
      // any question content (e.g. flipping a visibility flag on an
      // already-translated assignment) enqueues zero translation jobs. In
      // that case the in-flight seed and the poll loop downstream are both
      // no-ops — skip them so the publish returns immediately instead of
      // spinning until the 30-minute poll timeout.
      const willEnqueueAnyTranslation =
        shouldTranslateAssignment || perQuestionTranslationJobsEnqueued > 0;

      // Translation work has moved off the publish hot path onto the
      // dedicated translations queue. Before fanning out, seed the
      // per-assignment in-flight refcount hash with the number of workers
      // that will translate each language across this publish (one
      // worker per question + per variant + per meta job, uniform across
      // languages). The learner-side loop reads the counter to
      // distinguish "translation still running" (count > 0) from
      // "translation never produced a row" (count == 0 or absent). Each
      // worker decrements its language counter as it terminates; a
      // 30-minute TTL fallback eventually clears the hash if the publish
      // job dies mid-flight.
      const supportedLanguageCodes = getAllLanguageCodes();
      const perLanguageWorkerCount =
        perQuestionTranslationJobsEnqueued +
        (shouldTranslateAssignment ? 1 : 0);
      let metaEnqueued = false;
      if (
        willEnqueueAnyTranslation &&
        supportedLanguageCodes.length > 0 &&
        perLanguageWorkerCount > 0 &&
        this.translationStateRedis
      ) {
        await seedInflightLanguages(
          this.translationStateRedis,
          assignmentId,
          supportedLanguageCodes,
          perLanguageWorkerCount,
        );
      }

      if (shouldTranslateAssignment) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress:
            "Content changes detected, dispatching assignment translation",
          percentage: 80,
        });

        // Assignment-meta translation (name / introduction / instructions /
        // grading-criteria) runs as its own retryable BullMQ job alongside
        // the per-question and per-variant jobs the question service
        // enqueued upstream. The publish job no longer awaits LLM calls.
        await this.jobQueueService.enqueue(
          JOB_QUEUE_NAMES.ASSIGNMENT_V2_TRANSLATIONS,
          JOB_NAMES.TRANSLATE_META,
          {
            parentJobId: jobId,
            assignmentId,
          } satisfies TranslateMetaJobPayload,
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
        await this.translationService.markPending(jobId, "meta", assignmentId);
        metaEnqueued = true;
        this.logger.info("publish.translation.job.enqueued", {
          assignmentId,
          kind: "meta",
          id: assignmentId,
          parentJobId: jobId,
        });
      } else {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "In Progress",
          progress:
            "No translatable content changes detected; skipping assignment-meta translation",
          percentage: 85,
        });
      }

      // DB-writes-done boundary. From this point on, the publish job no
      // longer touches the database for translation work — per-question,
      // per-variant, and (when needed) per-assignment-meta translation jobs
      // run asynchronously on mark.assignment.v2.translations. A follow-up
      // poll loop will aggregate per-job progress for the SSE channel.
      this.logger.info("publish.complete", {
        assignmentId,
        jobId,
        dbWriteMs: Date.now() - publishStartedAt,
        jobsEnqueued: metaEnqueued ? 1 : 0,
        percentage: 100,
      });

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Finalizing publishing",
        percentage: 90,
      });

      const updatedQuestions =
        await this.questionService.getQuestionsForAssignment(assignmentId);
      const resolvedQuestionOrder = this.resolveQuestionOrder(
        updateDto,
        existingAssignment,
      );
      const questionOrder = this.normalizeQuestionOrder(
        resolvedQuestionOrder.map((id) => frontendToBackendIdMap.get(id) ?? id),
        updatedQuestions.map((question) => question.id),
      );

      await this.assignmentRepository.update(assignmentId, {
        questionOrder,
        published: updateDto.published,
      });

      if (questionContentChanged || !existingAssignment.published) {
        await this.questionService.updateQuestionGradingContext(assignmentId);
      }

      const orderedUpdatedQuestions = applyQuestionOrder(
        updatedQuestions,
        questionOrder,
      );

      this.logger.info(
        `Found ${orderedUpdatedQuestions.length} questions after processing for assignment ${assignmentId}`,
        {
          questionIds: orderedUpdatedQuestions.map((q) => q.id),
        },
      );

      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "Creating version snapshot",
        percentage: 95,
      });

      try {
        this.logger.info(
          `Managing version after question processing - found ${orderedUpdatedQuestions.length} questions`,
        );

        const userSession = {
          userId,
          role: "AUTHOR",
        } as unknown as UserSession;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const existingDraft =
          await this.versionManagementService.getUserLatestDraft(
            assignmentId,
            userSession,
          );

        const latestVersion =
          await this.versionManagementService.getLatestVersion(assignmentId);

        let versionResult: VersionSummary;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (
          existingDraft &&
          updateDto.published &&
          existingDraft?._draftVersionId
        ) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const draftVersionId = existingDraft._draftVersionId;
          this.logger.info(
            `Found existing draft version, publishing it instead of creating new version`,
            { draftVersionId },
          );

          await this.versionManagementService.saveDraft(
            assignmentId,
            {
              assignmentData: {
                name: updateDto.name,
                introduction: updateDto.introduction,
                instructions: updateDto.instructions,
                gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
                timeEstimateMinutes: updateDto.timeEstimateMinutes,
                requireAllQuestions: updateDto.requireAllQuestions,
                optionalQuestionIds: updateDto.optionalQuestionIds,
              },
              questionsData: orderedUpdatedQuestions,
              versionDescription:
                updateDto.versionDescription ??
                `Published version - ${new Date().toLocaleDateString()}`,
              versionNumber: updateDto.versionNumber,
            },
            userSession,
          );

          versionResult = await this.versionManagementService.publishVersion(
            assignmentId,
            draftVersionId,
            { userSession },
          );
        } else if (
          latestVersion &&
          !latestVersion.published &&
          updateDto.published
        ) {
          this.logger.info(
            `Found recently created unpublished version ${latestVersion.versionNumber}, publishing it instead of creating duplicate`,
            {
              versionId: latestVersion.id,
              versionNumber: latestVersion.versionNumber,
            },
          );

          versionResult = await this.versionManagementService.publishVersion(
            assignmentId,
            latestVersion.id,
            { userSession },
          );
        } else if (!existingDraft && updateDto.published) {
          this.logger.info(
            `No existing draft or unpublished version found, creating new version directly`,
          );
          this.logger.info(
            `UpdateDto contains versionNumber: ${updateDto.versionNumber}, versionDescription: ${updateDto.versionDescription}`,
          );

          versionResult = await this.versionManagementService.createVersion(
            assignmentId,
            {
              versionNumber: updateDto.versionNumber,
              versionDescription:
                updateDto.versionDescription ??
                `Version - ${new Date().toLocaleDateString()}`,
              isDraft: false,
              shouldActivate: true,
            },
            userSession,
          );
        } else {
          this.logger.info(`Saving as draft version`);

          versionResult = await this.versionManagementService.saveDraft(
            assignmentId,
            {
              assignmentData: {
                name: updateDto.name,
                introduction: updateDto.introduction,
                instructions: updateDto.instructions,
                gradingCriteriaOverview: updateDto.gradingCriteriaOverview,
                timeEstimateMinutes: updateDto.timeEstimateMinutes,
                requireAllQuestions: updateDto.requireAllQuestions,
                optionalQuestionIds: updateDto.optionalQuestionIds,
              },
              questionsData: orderedUpdatedQuestions,
              versionDescription:
                updateDto.versionDescription ??
                `Draft - ${new Date().toLocaleDateString()}`,
              versionNumber: updateDto.versionNumber,
            },
            userSession,
          );
        }

        this.logger.info(
          `Successfully managed version ${versionResult.id} for assignment ${assignmentId} during publishing with ${versionResult.questionCount} questions`,
          {
            versionNumber: versionResult.versionNumber,
            isDraft: versionResult.isDraft,
            isActive: versionResult.isActive,
            published: versionResult.published,
          },
        );
      } catch (versionError) {
        this.logger.error(
          `Failed to create version during publishing for assignment ${assignmentId}:`,
          {
            error:
              versionError instanceof Error
                ? versionError.message
                : "Unknown error",
            stack:
              versionError instanceof Error ? versionError.stack : undefined,
            assignmentId,
            userId,
            questionsFound: orderedUpdatedQuestions.length,
          },
        );
      }

      try {
        await this.attemptAccessCache.invalidateForAssignment(assignmentId);
      } catch (cacheError) {
        this.logger.warn(
          `Failed to invalidate attempt-access cache after publish for assignment ${assignmentId}: ${
            cacheError instanceof Error ? cacheError.message : "Unknown error"
          }`,
        );
      }

      // Stage 1: DB writes are complete and translation jobs have been
      // enqueued. Surface this once on the SSE stream BEFORE entering the
      // poll loop so consumers can transition UI state from "publishing" to
      // "translating" immediately — without waiting for the first poll
      // tick (which may be empty if no worker has HSET yet).
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "In Progress",
        progress: "DB writes complete; translation jobs queued",
        percentage: 100,
        result: { stage: "db_writes_done" } satisfies PublishJobResult,
      });

      // No translation jobs were enqueued (e.g. metadata-only republish of
      // an already-translated assignment). Emit a single terminal
      // translations_complete tick and return — the poll loop below would
      // otherwise spin for the full 30-minute timeout against an empty
      // per-publish status hash that no worker will ever populate.
      if (!willEnqueueAnyTranslation) {
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress: "Publishing complete (no translation work required)",
          percentage: 100,
          result: {
            stage: "translations_complete",
            translations: {
              aggregate: { completed: 0, total: 0, failed: 0 },
              perJob: [],
            },
          } satisfies PublishJobResult,
        });
        return;
      }

      // Stage 2 + 3: 1-second poll loop. Each tick reads the per-publish
      // status hash, aggregates per-job entries, and emits the rolled-up
      // PublishJobResult on the existing JobStatusUpdate.result field.
      // Loop exits when every spawned translation job has reached a
      // terminal status (completed | failed), or after the hard timeout.
      //
      // If Redis is unavailable (test envs without REDIS_URL, or a transient
      // outage), the status hash can't be populated and polling has nothing
      // to read. Skip the loop entirely and treat the publish as complete
      // at db_writes_done — workers will still run if Redis comes back,
      // they just won't surface SSE progress updates for this publish.
      if (!this.translationStateRedis) {
        this.logger.warn(
          "publish.translations.poll.skipped { reason: translation-status-redis-unavailable }",
        );
        await this.jobStatusService.updateJobStatus(jobId, {
          status: "Completed",
          progress:
            "Publishing complete (translation status tracking unavailable)",
          percentage: 100,
          result: {
            stage: "translations_complete",
            translations: {
              aggregate: { completed: 0, total: 0, failed: 0 },
              perJob: [],
            },
          } satisfies PublishJobResult,
        });
        return;
      }
      const pollHashKey = buildPublishHashKey(jobId);
      const pollStartedAt = Date.now();
      for (;;) {
        const entries =
          (await this.translationStateRedis?.hgetall(pollHashKey)) ?? {};
        const perJob: PerJobTranslationEntry[] = Object.values(entries).map(
          (raw) => JSON.parse(raw) as PerJobTranslationEntry,
        );
        const completed = perJob.filter(
          (entry) => entry.status === "completed",
        ).length;
        const failed = perJob.filter(
          (entry) => entry.status === "failed",
        ).length;
        const total = perJob.length;
        // Guard against premature exit on the first tick when no worker
        // has HSET yet (total === 0). The loop keeps polling until at
        // least one entry exists AND all entries are terminal.
        const allTerminal =
          total > 0 &&
          perJob.every(
            (entry) =>
              entry.status === "completed" || entry.status === "failed",
          );

        const tickResult: PublishJobResult = {
          stage: allTerminal
            ? "translations_complete"
            : "translations_in_progress",
          translations: {
            aggregate: { completed, total, failed },
            perJob,
          },
        };

        await this.jobStatusService.updateJobStatus(jobId, {
          status: allTerminal ? "Completed" : "In Progress",
          progress: allTerminal
            ? "Publishing complete (translations finished)"
            : `Translating: ${completed}/${total} questions complete`,
          percentage: 100,
          result: tickResult,
        });

        if (allTerminal) {
          break;
        }

        if (Date.now() - pollStartedAt > PUBLISH_TRANSLATION_POLL_TIMEOUT_MS) {
          this.logger.warn("publish.translations.poll.timeout", {
            assignmentId,
            jobId,
            completed,
            total,
            failed,
            elapsedMs: Date.now() - pollStartedAt,
          });
          await this.jobStatusService.updateJobStatus(jobId, {
            status: "Completed",
            progress: "Publishing complete (translation poll timed out)",
            percentage: 100,
            result: {
              stage: "translations_complete",
              translations: {
                aggregate: { completed, total, failed },
                perJob,
              },
            } satisfies PublishJobResult,
          });
          break;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, PUBLISH_TRANSLATION_POLL_INTERVAL_MS),
        );
      }

      // Best-effort cleanup of the per-publish status hash. The 1-hour
      // TTL on first HSET covers a failed DEL, so a Redis blip here only
      // delays cleanup — it never blocks the publish from completing.
      try {
        await this.translationStateRedis?.del(pollHashKey);
      } catch (delError) {
        this.logger.warn("publish.translations.cleanup.failed", {
          assignmentId,
          jobId,
          error:
            delError instanceof Error ? delError.message : String(delError),
        });
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Publishing process failed: ${errorMessage}`,
        errorStack,
      );
      await this.jobStatusService.updateJobStatus(jobId, {
        status: "Failed",
        progress: `Error: ${errorMessage}`,
      });
      throw error;
    }
  }

  private safeStringCompare = (
    string1: string | null | undefined,
    string2: string | null | undefined,
  ): boolean => {
    const normalizedString1 =
      string1 === null || string1 === undefined ? "" : String(string1);
    const normalizedString2 =
      string2 === null || string2 === undefined ? "" : String(string2);
    return normalizedString1 === normalizedString2;
  };

  /**
   * Check if translatable assignment fields have changed
   */
  private haveTranslatableAssignmentFieldsChanged(
    existingAssignment:
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto,
    updateDto: UpdateAssignmentRequestDto | UpdateAssignmentQuestionsDto,
  ): boolean {
    if (existingAssignment.graded !== updateDto.graded) {
      this.logger.debug(
        "Graded status changed, but this doesn't trigger translation",
      );
    }

    const nameChanged =
      updateDto.name !== undefined &&
      updateDto.name !== null &&
      !this.safeStringCompare(existingAssignment.name, updateDto.name);

    const instructionsChanged =
      updateDto.instructions !== undefined &&
      updateDto.instructions !== null &&
      !this.safeStringCompare(
        existingAssignment.instructions,
        updateDto.instructions,
      );

    const introductionChanged =
      updateDto.introduction !== undefined &&
      updateDto.introduction !== null &&
      !this.safeStringCompare(
        existingAssignment.introduction,
        updateDto.introduction,
      );

    const gradingCriteriaChanged =
      updateDto.gradingCriteriaOverview !== undefined &&
      updateDto.gradingCriteriaOverview !== null &&
      !this.safeStringCompare(
        existingAssignment.gradingCriteriaOverview,
        updateDto.gradingCriteriaOverview,
      );
    if (
      nameChanged ||
      instructionsChanged ||
      introductionChanged ||
      gradingCriteriaChanged
    ) {
      this.logger.debug(`Translatable fields changed: 
      name: ${String(nameChanged)}, 
      instructions: ${String(instructionsChanged)}, 
      introduction: ${String(introductionChanged)}, 
      gradingCriteria: ${String(gradingCriteriaChanged)}
    `);
    } else {
      this.logger.debug("No translatable fields changed");
    }

    return (
      nameChanged ||
      instructionsChanged ||
      introductionChanged ||
      gradingCriteriaChanged
    );
  }
  /**
   * Enhanced method to check if question content has changed with detailed logging
   */
  private haveQuestionContentsChanged(
    existingQuestions: QuestionDto[],
    updatedQuestions: QuestionDto[],
  ): boolean {
    if (existingQuestions.length !== updatedQuestions.length) {
      this.logger.debug(
        `Question count changed: ${existingQuestions.length} → ${updatedQuestions.length}`,
      );
      return true;
    }

    this.logger.debug(
      `Comparing ${existingQuestions.length} questions for content changes`,
    );

    const existingQuestionsMap = new Map<number, QuestionDto>();
    for (const question of existingQuestions) {
      existingQuestionsMap.set(question.id, question);
    }

    for (const updatedQuestion of updatedQuestions) {
      const existingQuestion = existingQuestionsMap.get(updatedQuestion.id);

      if (!existingQuestion) {
        this.logger.debug(`New question detected: ID ${updatedQuestion.id}`);
        return true;
      }

      this.logger.debug(`Comparing question #${updatedQuestion.id}:
      Text: "${existingQuestion.question}" → "${updatedQuestion.question}"
      Type: "${existingQuestion.type}" → "${updatedQuestion.type}"
      Total Points: ${existingQuestion.totalPoints} → ${
        updatedQuestion.totalPoints
      }
      Choices Count: ${existingQuestion.choices?.length || 0} → ${
        updatedQuestion.choices?.length || 0
      }
      Variants Count: ${existingQuestion.variants?.length || 0} → ${
        updatedQuestion.variants?.length || 0
      }
    `);

      if (
        !this.safeStringCompare(
          updatedQuestion.question,
          existingQuestion.question,
        )
      ) {
        this.logger.debug(`Question #${updatedQuestion.id} text changed`);
        return true;
      }

      if (updatedQuestion.type !== existingQuestion.type) {
        this.logger.debug(
          `Question #${updatedQuestion.id} type changed: ${existingQuestion.type} → ${updatedQuestion.type}`,
        );
        return true;
      }

      const choicesEqual = this.areChoicesEqual(
        updatedQuestion.choices,
        existingQuestion.choices,
      );
      if (!choicesEqual) {
        this.logger.debug(`Question #${updatedQuestion.id} choices changed`);
        return true;
      }

      const variantsChanged = this.haveVariantsChanged(
        existingQuestion.variants,
        updatedQuestion.variants,
        updatedQuestion.id,
      );

      if (variantsChanged) {
        this.logger.debug(`Question #${updatedQuestion.id} variants changed`);
        return true;
      }

      if (updatedQuestion.totalPoints !== existingQuestion.totalPoints) {
        this.logger.debug(
          `Question #${updatedQuestion.id} points changed: ${existingQuestion.totalPoints} → ${updatedQuestion.totalPoints} (non-translatable)`,
        );
      }

      if (updatedQuestion.maxWords !== existingQuestion.maxWords) {
        this.logger.debug(
          `Question #${updatedQuestion.id} maxWords changed: ${existingQuestion.maxWords} → ${updatedQuestion.maxWords} (non-translatable)`,
        );
      }
    }

    this.logger.debug(`No content changes detected in any questions`);
    return false;
  }

  /**
   * Resolve the correct question order to persist without wiping existing order
   * when question payloads are omitted (e.g., config-only publishes).
   */
  private resolveQuestionOrder(
    updateDto: UpdateAssignmentQuestionsDto,
    existingAssignment:
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto,
  ): number[] {
    const updatedQuestions = Array.isArray(updateDto.questions)
      ? updateDto.questions
      : [];
    const existingQuestions = Array.isArray(
      (existingAssignment as GetAssignmentResponseDto).questions,
    )
      ? (existingAssignment as GetAssignmentResponseDto).questions
      : [];

    const validQuestionIds =
      updatedQuestions.length > 0
        ? updatedQuestions.map((q) => q.id)
        : existingQuestions.map((q) => q.id);

    const preferredOrder =
      Array.isArray(updateDto.questionOrder) &&
      updateDto.questionOrder.length > 0
        ? updateDto.questionOrder
        : updatedQuestions.length > 0
          ? updatedQuestions.map((q) => q.id)
          : (existingAssignment.questionOrder ?? []);

    const normalizedOrder = this.normalizeQuestionOrder(
      preferredOrder,
      validQuestionIds,
    );

    if (normalizedOrder.length === 0 && validQuestionIds.length > 0) {
      return [...validQuestionIds];
    }

    return normalizedOrder;
  }

  /**
   * Normalize question order to valid IDs while preserving explicit ordering.
   */
  private normalizeQuestionOrder(
    order: number[],
    validIds: number[],
  ): number[] {
    const validSet = new Set(validIds);
    const seen = new Set<number>();
    const normalized: number[] = [];

    for (const id of order) {
      if (validSet.has(id) && !seen.has(id)) {
        normalized.push(id);
        seen.add(id);
      }
    }

    for (const id of validIds) {
      if (!seen.has(id)) {
        normalized.push(id);
        seen.add(id);
      }
    }

    return normalized;
  }

  /**
   * Enhanced method to check if variants have changed with optional question ID for logging
   */
  private haveVariantsChanged(
    variants1?: VariantDto[],
    variants2?: VariantDto[],
    questionId?: number,
  ): boolean {
    const logPrefix = questionId
      ? `Question #${questionId} variants: `
      : "Variants: ";

    if (!variants1 && !variants2) {
      this.logger.debug(
        `${logPrefix}Both variant arrays are null/undefined (no change)`,
      );
      return false;
    }

    if (!variants1 || !variants2) {
      this.logger.debug(
        `${logPrefix}One variant array is null/undefined (change detected)`,
      );
      return true;
    }

    if (variants1.length !== variants2.length) {
      this.logger.debug(
        `${logPrefix}Variant count changed: ${variants1.length} → ${variants2.length}`,
      );
      return true;
    }

    if (variants1.length === 0) {
      this.logger.debug(
        `${logPrefix}Both variant arrays are empty (no change)`,
      );
      return false;
    }

    this.logger.debug(`${logPrefix}Comparing ${variants1.length} variants`);

    const sortedVariants1 = [...variants1].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    const sortedVariants2 = [...variants2].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );

    for (const [index, v1] of sortedVariants1.entries()) {
      const v2 = sortedVariants2[index];

      this.logger.debug(`${logPrefix}Comparing variant #${index + 1}:
      Content: "${v1.variantContent.slice(
        0,
        30,
      )}..." → "${v2.variantContent.slice(0, 30)}..."
      Choices Count: ${v1.choices?.length || 0} → ${v2.choices?.length || 0}
    `);

      if (!this.safeStringCompare(v1.variantContent, v2.variantContent)) {
        this.logger.debug(`${logPrefix}Variant #${index + 1} content changed`);
        return true;
      }

      if (!this.areChoicesEqual(v1.choices, v2.choices)) {
        this.logger.debug(`${logPrefix}Variant #${index + 1} choices changed`);
        return true;
      }
    }

    this.logger.debug(`${logPrefix}No changes detected in variants`);
    return false;
  }

  /**
   * Corrected method to check if choices have changed
   * Returns TRUE if they are equal (no change), FALSE if they're different
   */
  private areChoicesEqual(choices1?: Choice[], choices2?: Choice[]): boolean {
    if (!choices1 && !choices2) return true;
    if (!choices1 || !choices2) return false;
    if (choices1.length !== choices2.length) return false;
    const sortedChoices1 = [...choices1].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    const sortedChoices2 = [...choices2].sort(
      (a, b) => (a.id || 0) - (b.id || 0),
    );
    for (const [index, c1] of sortedChoices1.entries()) {
      const c2 = sortedChoices2[index];
      if (
        (c1.choice !== undefined &&
          !this.safeStringCompare(c1.choice, c2.choice)) ||
        !this.safeStringCompare(c1.feedback, c2.feedback) ||
        (c1.isCorrect !== undefined && c1.isCorrect !== c2.isCorrect)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Determine if an assignment needs translation after updates
   *
   * @param existingAssignment - The current assignment data
   * @param updateDto - The updated assignment data
   * @returns Boolean indicating if translation is needed
   */
  private shouldTranslateAssignment(
    existingAssignment:
      | GetAssignmentResponseDto
      | LearnerGetAssignmentResponseDto,
    updateDto: UpdateAssignmentRequestDto,
  ): boolean {
    return (
      (updateDto.name && updateDto.name !== existingAssignment.name) ||
      (updateDto.instructions &&
        updateDto.instructions !== existingAssignment.instructions) ||
      (updateDto.introduction &&
        updateDto.introduction !== existingAssignment.introduction) ||
      (updateDto.gradingCriteriaOverview &&
        updateDto.gradingCriteriaOverview !==
          existingAssignment.gradingCriteriaOverview)
    );
  }
}
