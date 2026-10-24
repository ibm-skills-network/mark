import {
  RetryableProcessingError,
  SourceProcessingError,
} from "../../../llm/features/grading/errors/source-processing.error";
/* eslint-disable @typescript-eslint/require-await */
/* eslint-disable unicorn/no-null */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Question, QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import {
  authorAssignmentDetailsDTO,
  LearnerUpdateAssignmentAttemptRequestDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionService } from "src/api/assignment/question/question.service";
import {
  convertGitHubUrlToRaw,
  fetchUrlContentForGrading,
} from "src/api/attempt/common/utils/github-content-fetch.util";
import { normalizeLearnerUrl } from "src/api/attempt/common/utils/learner-url.util";
import { stripImagesFromLearnerHtml } from "src/api/attempt/common/utils/learner-text-images.util";
import { QuestionAnswerContext } from "src/api/llm/model/base.question.evaluate.model";
import { RetryableUrlFetchError } from "../../../llm/features/grading/errors/retryable-url-fetch.error";
import { LearnerFacingGradingError } from "../../../llm/features/grading/errors/learner-facing-grading.error";
import type { GradingIssue } from "../../../llm/features/grading/errors/grading-failure";
import { issueFromQuestionError } from "../../../llm/features/grading/errors/grading-failure.mapper";
import { Logger } from "winston";
import { UserRole } from "../../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../../database/prisma.service";
import { sanitizeUnicodeForJson } from "../../../../helpers/sanitize-unicode";
import { GradingContext } from "../../common/interfaces/grading-context.interface";
import {
  buildChoiceRenderings,
  ChoiceRendering,
  parseStoredChoices,
} from "../../common/utils/choice-renderings.util";
import {
  applyQuestionTranslation,
  findQuestionTranslation,
} from "../../common/utils/translation-language.util";
import { LocalizationService } from "../../common/utils/localization.service";
import { applyVariantToQuestion } from "../../common/utils/grading-question-source.util";
import {
  findLearnerFileReferenceDenial,
  InvalidLearnerFileReferenceException,
} from "../../common/utils/learner-file-reference.util";
import { S3Service } from "../../../files/services/s3.service";
import { GradingFactoryService } from "../grading-factory.service";
import {
  buildTranslationCacheKey,
  newJobScopedCache,
  type JobScopedCache,
} from "../grading/job-scoped-cache";
import {
  GradingProgressService,
  type SlowGradingType,
} from "../grading-progress.service";
import { GradingRateLimiterService } from "../grading-rate-limiter.service";

function issueHost(issue: GradingIssue): string | undefined {
  if (!issue.source?.url) return undefined;
  try {
    return new URL(issue.source.url).hostname;
  } catch {
    // Log context only; an unparseable learner answer has no host.
    return undefined;
  }
}

type PrismaTransactionalClient = Omit<
  PrismaService,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
>;

/**
 * A graded question item produced by Phase 2 (grading, no DB write).
 * Passed to commitAttemptWithResponses for Phase 3 (atomic DB write).
 */
export interface GradedItem {
  questionId: number;
  /** Raw extracted learner response (to be stored in QuestionResponse.learnerResponse) */
  learnerResponse: unknown;
  responseDto: CreateQuestionResponseAttemptResponseDto;
}

@Injectable()
export class QuestionResponseService {
  private readonly logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionService: QuestionService,
    private readonly localizationService: LocalizationService,
    private readonly gradingFactoryService: GradingFactoryService,
    private readonly rateLimiter: GradingRateLimiterService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
    @Inject("GradingProgressService")
    private readonly progressService?: GradingProgressService,
  ) {
    this.logger = parentLogger.child({
      context: QuestionResponseService.name,
    });
  }

  /**
   * Compute dependency levels from a topologically sorted question list.
   *
   * Level 0 = no gradingContextQuestionIds. Level N = max(level of incoming
   * deps) + 1. Questions in the same level have no inter-dependencies and
   * can be graded in parallel.
   */
  private computeGradingLevels(
    sorted: number[],
    questionMap: Map<number, QuestionDto>,
  ): number[][] {
    const level = new Map<number, number>();
    for (const qId of sorted) {
      const q = questionMap.get(qId);
      const depIds = (q?.gradingContextQuestionIds ?? []).filter((dep) =>
        questionMap.has(dep),
      );
      const depLevel =
        depIds.length > 0
          ? Math.max(...depIds.map((d) => level.get(d) ?? 0))
          : -1;
      level.set(qId, depLevel + 1);
    }

    const grouped = new Map<number, number[]>();
    for (const [qId, lvl] of level.entries()) {
      const existing = grouped.get(lvl) ?? [];
      existing.push(qId);
      grouped.set(lvl, existing);
    }
    return [...grouped.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, ids]) => ids);
  }

  /**
   * Slow-grading classifier — questions whose grading typically waits on file
   * ingest, transcript generation, or vision. The frontend uses this flag to
   * render a "this may take a bit longer" hint while the question is in flight.
   */
  private detectSlowType(question: QuestionDto): SlowGradingType | undefined {
    if (question.type === QuestionType.UPLOAD) return "UPLOAD";
    if (question.type === QuestionType.LINK_FILE) return "LINK_FILE";
    if (question.type === QuestionType.URL) return "URL";
    const responseType = question.responseType as string | undefined;
    if (responseType === "PRESENTATION") return "PRESENTATION";
    if (responseType === "VIDEO" || responseType === "LIVE_RECORDING") {
      return "VIDEO_PRESENTATION";
    }
    return undefined;
  }

  /**
   * DAG-aware wave scheduler — runs each topological level in parallel under
   * the dedicated grading Bottleneck. Questions in the same level have no
   * inter-dependencies; questions in a later level can read earlier levels'
   * responses from {@link inMemoryContext}.
   *
   * Caller supplies {@link gradeOne}, which encapsulates the per-question
   * context lookup + LLM call for either the learner or author path.
   */
  private async runGradingWaves(options: {
    attemptId: number;
    sorted: number[];
    questionMap: Map<number, QuestionDto>;
    requestMap: Map<number, CreateQuestionResponseAttemptRequestDto>;
    inMemoryContext: Map<number, string>;
    reportProgress: boolean;
    assignmentId?: number;
    /** Score a question the learner must fix as 0 instead of blocking the attempt. */
    scoreBlockedAsZero?: boolean;
    gradeOne: (
      question: QuestionDto,
      request: CreateQuestionResponseAttemptRequestDto,
      options: { sourceCheckOnly: boolean },
    ) => Promise<{
      learnerResponse: unknown;
      responseDto: CreateQuestionResponseAttemptResponseDto;
    }>;
  }): Promise<GradedItem[]> {
    const {
      attemptId,
      sorted,
      questionMap,
      requestMap,
      inMemoryContext,
      reportProgress,
      assignmentId,
      scoreBlockedAsZero = false,
      gradeOne,
    } = options;

    const levels = this.computeGradingLevels(sorted, questionMap);
    const gradedItems: GradedItem[] = [];
    const gradedItemsLock: { current: GradedItem[] } = { current: gradedItems };
    const parallelEnabled = this.rateLimiter.parallelEnabled;
    const totalQuestions = sorted.length;
    let gradedCount = 0;
    // Once any question fails nothing will be saved, so the rest of the
    // attempt only checks its links/files (to report every fixable problem in
    // one go) and starts no new model work. Questions already in flight finish.
    // When blocked questions score 0 instead, the rest is still graded in full.
    const failures: Array<{ questionId: number; error: unknown }> = [];

    for (const [waveIndex, wave] of levels.entries()) {
      this.logger.info(
        `grading.wave.start attempt=${attemptId} wave=${waveIndex} size=${wave.length} parallel=${parallelEnabled} sourceCheckOnly=${failures.length > 0}`,
      );

      await Promise.all(
        wave.map(async (questionId) => {
          const question = questionMap.get(questionId);
          const request = requestMap.get(questionId);
          if (!question || !request) return;

          if (reportProgress && this.progressService && parallelEnabled) {
            await this.progressService.setQuestionStatus(
              attemptId,
              questionId,
              "in_progress",
            );
          }

          let sourceCheckOnly = false;
          try {
            const result = await this.rateLimiter.schedule(
              `grade:q=${questionId}:a=${attemptId}`,
              () => {
                // Decided when the work actually starts, not when it queued.
                sourceCheckOnly = !scoreBlockedAsZero && failures.length > 0;
                return gradeOne(question, request, { sourceCheckOnly });
              },
            );
            if (sourceCheckOnly) return;

            result.responseDto.questionId = questionId;
            result.responseDto.question = question.question;
            gradedItemsLock.current.push({
              questionId,
              learnerResponse: result.learnerResponse,
              responseDto: result.responseDto,
            });
            inMemoryContext.set(
              questionId,
              JSON.stringify(result.learnerResponse ?? ""),
            );
            gradedCount += 1;

            if (reportProgress && this.progressService) {
              await (parallelEnabled
                ? this.progressService.setQuestionStatus(
                    attemptId,
                    questionId,
                    "completed",
                  )
                : this.progressService.updateQuestionProgress(
                    attemptId,
                    gradedCount,
                    totalQuestions,
                    `Grading question ${gradedCount} of ${totalQuestions}...`,
                  ));
            }
          } catch (error) {
            const fixable = issueFromQuestionError(error, questionId);
            const logMeta = {
              attemptId,
              assignmentId,
              questionId,
              sourceCheckOnly,
              errorClass: error instanceof Error ? error.name : typeof error,
              error: error instanceof Error ? error.message : String(error),
            };
            if (fixable) {
              this.logger.warn("grading.wave.question.blocked", logMeta);
            } else {
              this.logger.error("grading.wave.question.failed", {
                ...logMeta,
                stack: error instanceof Error ? error.stack : undefined,
              });
            }
            if (reportProgress && this.progressService && parallelEnabled) {
              await this.progressService.setQuestionStatus(
                attemptId,
                questionId,
                "failed",
              );
            }
            failures.push({ questionId, error });
          }
        }),
      );
    }

    if (failures.length > 0 && scoreBlockedAsZero) {
      const remaining: typeof failures = [];
      for (const failure of failures) {
        const issue = issueFromQuestionError(failure.error, failure.questionId);
        const question = questionMap.get(failure.questionId);
        const request = requestMap.get(failure.questionId);
        if (!issue || issue.retryable || !question || !request) {
          remaining.push(failure);
          continue;
        }
        this.logger.warn("grading.unable_to_grade.scored_zero", {
          attemptId,
          assignmentId,
          questionId: issue.questionId,
          code: issue.code,
          host: issueHost(issue),
          httpStatus: issue.source?.httpStatus,
        });
        gradedItems.push(
          this.blockedQuestionScoredZero(question, request, issue),
        );
      }
      if (remaining.length > 0) {
        throw this.resolveWaveFailures(
          remaining,
          sorted,
          attemptId,
          assignmentId,
        );
      }
      return gradedItems;
    }

    if (failures.length > 0) {
      throw this.resolveWaveFailures(failures, sorted, attemptId, assignmentId);
    }

    return gradedItems;
  }

  /**
   * A question the learner would have to fix (dead link, unreadable file),
   * scored 0 with the reason as its feedback. Used when there is no time left
   * to fix and resubmit, so the rest of the attempt still counts.
   */
  private blockedQuestionScoredZero(
    question: QuestionDto,
    request: CreateQuestionResponseAttemptRequestDto,
    issue: GradingIssue,
  ): GradedItem {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.questionId = question.id;
    responseDto.question = question.question;
    responseDto.totalPoints = 0;
    const feedback = new GeneralFeedbackDto();
    feedback.feedback = issue.message;
    responseDto.feedback = [feedback];
    responseDto.metadata = { unableToGrade: issue };

    let learnerResponse: unknown = request.learnerTextResponse ?? "";
    if (typeof request.learnerUrlResponse === "string") {
      const raw = request.learnerUrlResponse.trim();
      learnerResponse = normalizeLearnerUrl(raw) || raw;
    } else if (Array.isArray(request.learnerFileResponse)) {
      // The file couldn't be read, so keep where it is, not what it parsed to.
      learnerResponse = request.learnerFileResponse.map((file) => {
        const { content, ...rest } = file;
        return typeof content === "string" ? file : rest;
      });
    }
    return { questionId: question.id, learnerResponse, responseDto };
  }

  /**
   * Picks the one error an attempt with failed questions ends with.
   *
   * Problems the learner can fix win: every one of them is reported together
   * (in question order) as a single SourceProcessingError, and a transient
   * link failure in the same attempt is listed with them, since the learner
   * is resubmitting anyway. Our own failures are logged at error either way;
   * on their own they are rethrown so the job keeps its retry policy and the
   * learner sees "grading failed". Transient-only failures are rethrown for
   * the queue to retry.
   */
  private resolveWaveFailures(
    failures: Array<{ questionId: number; error: unknown }>,
    sorted: number[],
    attemptId: number,
    assignmentId?: number,
  ): unknown {
    const order = new Map(sorted.map((id, index) => [id, index]));
    const byQuestionOrder = [...failures].sort(
      (a, b) => (order.get(a.questionId) ?? 0) - (order.get(b.questionId) ?? 0),
    );

    const fixable: GradingIssue[] = [];
    const transient: GradingIssue[] = [];
    let firstTransientError: unknown;
    let firstUnexpectedError: unknown;
    for (const { questionId, error } of byQuestionOrder) {
      const issue = issueFromQuestionError(error, questionId);
      if (issue?.retryable) {
        transient.push(issue);
        firstTransientError ??= error;
      } else if (issue) {
        fixable.push(issue);
      } else if (error instanceof RetryableProcessingError) {
        firstTransientError ??= error;
      } else {
        firstUnexpectedError ??= error;
      }
    }

    if (fixable.length > 0) {
      const issues = byQuestionOrder
        .map(({ questionId }) =>
          [...fixable, ...transient].find(
            (index) => index.questionId === questionId,
          ),
        )
        .filter((issue): issue is GradingIssue => issue !== undefined);
      for (const issue of issues) {
        this.logger.warn("grading.unable_to_grade.issue", {
          attemptId,
          assignmentId,
          questionId: issue.questionId,
          code: issue.code,
          host: issueHost(issue),
          httpStatus: issue.source?.httpStatus,
          retryable: issue.retryable,
        });
      }
      if (firstUnexpectedError !== undefined) {
        this.logger.error("grading.unable_to_grade.with_unexpected_failure", {
          attemptId,
          assignmentId,
          error:
            firstUnexpectedError instanceof Error
              ? firstUnexpectedError.message
              : String(firstUnexpectedError),
          stack:
            firstUnexpectedError instanceof Error
              ? firstUnexpectedError.stack
              : undefined,
        });
      }
      return SourceProcessingError.aggregate(issues);
    }

    return firstUnexpectedError ?? firstTransientError;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 1+2: Grade learner questions (no DB writes)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Grade all questions for a learner submission without writing to the database.
   *
   * Phase 1 (short read tx): loads question DTOs and validates dependency order.
   * Phase 2 (no tx): calls LLM/grading strategies, maintains an in-memory context
   *   map so context questions graded earlier in the batch can be referenced without
   *   touching the DB.
   *
   * The caller is responsible for writing results via commitAttemptWithResponses().
   */
  async gradeQuestionsForLearner(
    responsesForQuestions: CreateQuestionResponseAttemptRequestDto[],
    assignmentAttemptId: number,
    assignmentId: number,
    language: string,
    preTranslatedQuestions?: Map<number, QuestionDto>,
    cache?: JobScopedCache,
    userId?: string,
    options: { scoreBlockedAsZero?: boolean } = {},
  ): Promise<GradedItem[]> {
    // Defense-in-depth: allocate a cache if the caller did not supply one.
    // The submission entrypoint (updateLearnerAttempt) now hoists this same
    // allocation up so pre-translate and grading share a cache, but this
    // fallback keeps the hoist below correct when the method is called
    // directly (tests, future callers) without an outer cache. The Phase-0
    // hoist must run unconditionally — without it, the parallel Promise.all
    // in Phase 1 fans out N concurrent assignment.findUnique +
    // question.findUnique calls.
    const effectiveCache: JobScopedCache = cache ?? newJobScopedCache();

    // ── Phase 0: Up-front question + assignment hoist (populates per-job cache before Phase 1 reads) ──
    // Both hoists must run BEFORE Phase 1's $transaction so the parallel `Promise.all`
    // inside Phase 1 sees a populated cache. Without the assignment hoist, the N concurrent
    // `getAssignmentContext` calls inside Phase 1 each see `cache?.assignment` as undefined
    // at the time of their cache check (the populate-on-resolve happens after the first
    // `await prisma.assignment.findUnique` returns), causing N races against the same row.
    if (effectiveCache.questions.size === 0) {
      const ids = responsesForQuestions.map((r) => r.id);
      if (ids.length > 0) {
        const rows = await this.prisma.question.findMany({
          where: { id: { in: ids } },
        });
        for (const row of rows) effectiveCache.questions.set(row.id, row);
      }
    }
    if (!effectiveCache.assignment) {
      const fetched = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { instructions: true },
      });
      if (fetched) effectiveCache.assignment = fetched;
    }

    // ── Phase 1: Read (short transaction) ────────────────────────────────────
    const { questionDtos, sorted, adj, inDegree } =
      await this.prisma.$transaction(
        async (tx) => {
          const questionDtos: QuestionDto[] = await Promise.all(
            responsesForQuestions.map(async (response) => {
              const { question } = await this.getLearnerQuestion(
                response.id,
                assignmentAttemptId,
                assignmentId,
                preTranslatedQuestions,
                tx as PrismaTransactionalClient,
                effectiveCache,
                language,
              );
              return question;
            }),
          );
          const sortResult = this.buildAndSortDependencies(questionDtos);
          return { questionDtos, ...sortResult };
        },
        { timeout: 10_000 },
      );

    if (sorted.length !== responsesForQuestions.length) {
      const nodesInCycle: number[] = [];
      for (const [questionId, degree] of inDegree.entries()) {
        if (degree > 0) nodesInCycle.push(questionId);
      }
      this.logger.error(
        `Cycle detected in question dependencies for assignment ${assignmentId}`,
        { inDegree, adj, nodesInCycle },
      );
      throw new InternalServerErrorException(
        `A cycle was detected in the question dependencies: ${nodesInCycle.join(
          ", ",
        )}`,
      );
    }

    // ── Phase 2: Grade (no transaction, parallel by wave) ────────────────────
    const totalQuestions = sorted.length;
    const questionMap = new Map(questionDtos.map((q) => [q.id, q]));
    const requestMap = new Map(responsesForQuestions.map((r) => [r.id, r]));
    // In-memory responses for context questions graded in earlier waves.
    // Key = questionId, value = JSON-stringified learnerResponse (matches DB format).
    const inMemoryContextResponses = new Map<number, string>();

    if (this.progressService) {
      await this.progressService.initializeProgress(
        assignmentAttemptId,
        totalQuestions,
      );
      if (this.rateLimiter.parallelEnabled) {
        this.progressService.initializeQuestions(
          assignmentAttemptId,
          questionDtos.map((q, index) => ({
            id: q.id,
            displayOrder: index,
            slowType: this.detectSlowType(q),
          })),
        );
      }
    }

    for (const request of responsesForQuestions) {
      request.language = language;
    }

    const gradedItems = await this.runGradingWaves({
      attemptId: assignmentAttemptId,
      sorted,
      questionMap,
      requestMap,
      inMemoryContext: inMemoryContextResponses,
      reportProgress: true,
      assignmentId,
      scoreBlockedAsZero: options.scoreBlockedAsZero,
      gradeOne: async (question, request, { sourceCheckOnly }) => {
        const assignmentContext = await this.getAssignmentContext(
          assignmentId,
          question.id,
          assignmentAttemptId,
          undefined,
          inMemoryContextResponses,
          effectiveCache,
        );
        return this.gradeQuestionNoSave(
          question,
          request,
          assignmentContext,
          assignmentId,
          language,
          UserRole.LEARNER,
          assignmentAttemptId,
          userId,
          sourceCheckOnly,
        );
      },
    });

    // Deliberately does NOT mark grading complete. The progress row is the
    // learner-facing "your grade is ready" signal, and at this point nothing
    // has been written: the grade still has to be computed, the LTI callback
    // still has to run, and commitAttemptWithResponses still has to persist
    // the responses and the grade. The caller flips the row once that commit
    // returns — see markGradingComplete.
    return gradedItems;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Phase 3: Atomic write (QuestionResponse records + AssignmentAttempt grade)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Atomically write all graded question responses and update the AssignmentAttempt
   * grade in a single short transaction (<5s). This eliminates the gap between
   * QuestionResponse inserts and the grade update that could leave orphan state.
   *
   * Uses an optimistic lock on AssignmentAttempt.version to detect concurrent writes.
   * Throws ConflictException if the attempt was concurrently submitted by another worker.
   */
  async commitAttemptWithResponses(
    assignmentAttemptId: number,
    gradedItems: GradedItem[],
    grade: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
  ): Promise<{ id: number; submitted: boolean; grade: number | null }> {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const {
      responsesForQuestions: _r,
      authorQuestions: _aq,
      authorAssignmentDetails: _aad,
      language,
      preTranslatedQuestions: _pt,
      expiresAt: _ignoredExpiresAt,
      ...cleanedUpdateDto
    } = updateDto;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    const current = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      select: { submitted: true },
    });

    if (!current) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    if (current.submitted) {
      throw new ConflictException(
        `Attempt ${assignmentAttemptId} has already been submitted.`,
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Write all QuestionResponse records
        for (const {
          questionId,
          learnerResponse,
          responseDto,
        } of gradedItems) {
          await this.saveResponseToDatabase(
            assignmentAttemptId,
            questionId,
            learnerResponse,
            responseDto,
            UserRole.LEARNER,
            tx as PrismaTransactionalClient,
          );
        }

        // Atomically update AssignmentAttempt only if it is still not submitted.
        const updateResult = await (
          tx as PrismaTransactionalClient
        ).assignmentAttempt.updateMany({
          where: {
            id: assignmentAttemptId,
            submitted: false,
          },
          data: {
            ...cleanedUpdateDto,
            submitted: true,
            preferredLanguage: language ?? "en",
            expiresAt: new Date(),
            grade,
          },
        });

        // Shape check, not paranoia: instrumentation that wraps the Prisma
        // client can resolve a failed query with the Error object instead of
        // rejecting. `count` would then be undefined and the conflict check
        // below would silently pass over a write that never happened.
        if (typeof updateResult?.count !== "number") {
          throw new InternalServerErrorException(
            `Commit for attempt ${assignmentAttemptId} got a malformed updateMany result; aborting.`,
          );
        }

        if (updateResult.count === 0) {
          throw new ConflictException(
            `Attempt ${assignmentAttemptId} was concurrently submitted. ` +
              `Grading results were discarded to prevent duplicate submission.`,
          );
        }

        const committed = await (
          tx as PrismaTransactionalClient
        ).assignmentAttempt.findUnique({
          where: { id: assignmentAttemptId },
          select: { id: true, submitted: true, grade: true },
        });

        if (
          !committed ||
          typeof committed.id !== "number" ||
          committed.submitted !== true
        ) {
          throw new InternalServerErrorException(
            `Commit for attempt ${assignmentAttemptId} could not be read back as submitted; aborting.`,
          );
        }

        return committed;
      },
      { timeout: 60_000 },
    );
  }

  /**
   * Flip the attempt's grading progress to COMPLETED.
   *
   * Split out of the grading phase on purpose: COMPLETED is what tells a
   * learner their grade is readable, so it must not become visible until
   * commitAttemptWithResponses has durably written the QuestionResponse rows
   * and the AssignmentAttempt grade. Callers invoke this immediately after
   * that commit succeeds; when the commit fails they must not call it at all.
   *
   * On the queued grading path, a commit failure leaves the row at
   * PROCESSING and the job's own failure handler is what moves it to
   * FAILED. The inline (non-queued, synchronous) submission path has no
   * equivalent repair today, so a commit failure there currently strands
   * the row at PROCESSING rather than FAILED — a known gap, not something
   * this method papers over.
   */
  async markGradingComplete(assignmentAttemptId: number): Promise<void> {
    await this.progressService?.markComplete(assignmentAttemptId);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Legacy entry point (author preview + backward compat)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Submit all questions for an assignment attempt.
   *
   * For LEARNER: prefer the split gradeQuestionsForLearner() + commitAttemptWithResponses()
   * flow so that the grade write is atomic with the response writes. This method
   * is kept for AUTHOR preview (no DB writes) and for cases where the split API
   * is not available.
   */
  async submitQuestions(
    responsesForQuestions: CreateQuestionResponseAttemptRequestDto[],
    assignmentAttemptId: number,
    role: UserRole,
    assignmentId: number,
    language: string,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
    preTranslatedQuestions?: Map<number, QuestionDto>,
    userId?: string,
  ): Promise<CreateQuestionResponseAttemptResponseDto[]> {
    // ── Phase 1: Read (short transaction) ────────────────────────────────────
    const { questionDtos, sorted, adj, inDegree } =
      await this.prisma.$transaction(
        async (tx) => {
          const questionDtos: QuestionDto[] = await Promise.all(
            responsesForQuestions.map(async (response) => {
              const questionId = response.id;
              if (role === UserRole.LEARNER) {
                const { question } = await this.getLearnerQuestion(
                  questionId,
                  assignmentAttemptId,
                  assignmentId,
                  preTranslatedQuestions,
                  tx as PrismaTransactionalClient,
                  undefined,
                  language,
                );
                return question;
              } else if (role === UserRole.AUTHOR) {
                const { question } = this.getAuthorQuestion(
                  questionId,
                  authorQuestions,
                  assignmentDetails,
                );
                return question;
              } else {
                throw new BadRequestException(`Unsupported user role: ${role}`);
              }
            }),
          );
          const sortResult = this.buildAndSortDependencies(questionDtos);
          return { questionDtos, ...sortResult };
        },
        { timeout: 10_000 },
      );

    if (sorted.length !== responsesForQuestions.length) {
      const nodesInCycle = [];
      for (const [questionId, degree] of inDegree.entries()) {
        if (degree > 0) {
          nodesInCycle.push(questionId);
        }
      }
      this.logger.error(
        `Cycle detected in question dependencies for assignment ${assignmentId}`,
        { inDegree, adj, nodesInCycle },
      );
      throw new InternalServerErrorException(
        `A cycle was detected in the question dependencies: ${nodesInCycle.join(
          ", ",
        )}`,
      );
    }

    // ── Phase 2: Grade (no transaction, parallel by wave) ────────────────────
    const totalQuestions = sorted.length;
    const reportProgress = Boolean(this.progressService);

    if (reportProgress && this.progressService) {
      await this.progressService.initializeProgress(
        assignmentAttemptId,
        totalQuestions,
      );
      if (this.rateLimiter.parallelEnabled) {
        this.progressService.initializeQuestions(
          assignmentAttemptId,
          questionDtos.map((q, index) => ({
            id: q.id,
            displayOrder: index,
            slowType: this.detectSlowType(q),
          })),
        );
      }
    }

    const questionMap = new Map(questionDtos.map((q) => [q.id, q]));
    const requestMap = new Map(responsesForQuestions.map((r) => [r.id, r]));
    const inMemoryContextResponses = new Map<number, string>();

    for (const request of responsesForQuestions) {
      request.language = language;
    }

    const gradedItems = await this.runGradingWaves({
      attemptId: assignmentAttemptId,
      sorted,
      questionMap,
      requestMap,
      inMemoryContext: inMemoryContextResponses,
      reportProgress,
      assignmentId,
      gradeOne: async (question, request, { sourceCheckOnly }) => {
        const assignmentContext: {
          assignmentInstructions: string;
          questionAnswerContext: QuestionAnswerContext[];
        } =
          role === UserRole.LEARNER
            ? await this.getAssignmentContext(
                assignmentId,
                question.id,
                assignmentAttemptId,
                undefined,
                inMemoryContextResponses,
              )
            : {
                assignmentInstructions: assignmentDetails?.instructions ?? "",
                questionAnswerContext: [],
              };
        return this.gradeQuestionNoSave(
          question,
          request,
          assignmentContext,
          assignmentId,
          language,
          role,
          assignmentAttemptId,
          userId,
          sourceCheckOnly,
        );
      },
    });

    // ── Phase 3: Write (short transaction) — LEARNER only ────────────────────
    if (role !== UserRole.AUTHOR) {
      await this.prisma.$transaction(
        async (tx) => {
          for (const {
            questionId,
            learnerResponse,
            responseDto,
          } of gradedItems) {
            await this.saveResponseToDatabase(
              assignmentAttemptId,
              questionId,
              learnerResponse,
              responseDto,
              role,
              tx as PrismaTransactionalClient,
            );
          }
        },
        { timeout: 60_000 },
      );
    }

    // COMPLETED after the write, for the same reason as the split learner
    // flow. Author preview has no write phase and no persisted progress row
    // (its attempt id is negative), so this is simply the end of its pipeline.
    if (reportProgress && this.progressService) {
      await this.progressService.markComplete(assignmentAttemptId);
    }

    return gradedItems.map((g) => g.responseDto);
  }

  private buildAndSortDependencies(questions: QuestionDto[]): {
    sorted: number[];
    adj: Map<number, number[]>;
    inDegree: Map<number, number>;
  } {
    const adj = new Map<number, number[]>();
    const inDegree = new Map<number, number>();
    const questionIds = new Set(questions.map((q) => q.id));

    for (const q of questions) {
      adj.set(q.id, []);
      inDegree.set(q.id, 0);
    }

    for (const q of questions) {
      for (const depId of q.gradingContextQuestionIds ?? []) {
        if (questionIds.has(depId)) {
          const dependentQuestions = adj.get(depId);
          if (!dependentQuestions) {
            continue;
          }
          dependentQuestions.push(q.id);
          inDegree.set(q.id, (inDegree.get(q.id) ?? 0) + 1);
        }
      }
    }

    const queue = questions
      .filter((q) => (inDegree.get(q.id) ?? 0) === 0)
      .map((q) => q.id);
    const sorted: number[] = [];

    while (queue.length > 0) {
      const u = queue.shift();
      if (u === undefined) {
        continue;
      }
      sorted.push(u);

      for (const v of adj.get(u) ?? []) {
        inDegree.set(v, (inDegree.get(v) ?? 0) - 1);
        if ((inDegree.get(v) ?? 0) === 0) {
          queue.push(v);
        }
      }
    }

    return { sorted, adj, inDegree };
  }

  /**
   * Grade a single question without writing to the database.
   * Used by both the gradeQuestionsForLearner Phase 2 and the legacy submitQuestions.
   */
  private async gradeQuestionNoSave(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
    language: string,
    role: UserRole,
    assignmentAttemptId: number,
    userId?: string,
    sourceCheckOnly = false,
  ): Promise<{
    learnerResponse: unknown;
    responseDto: CreateQuestionResponseAttemptResponseDto;
  }> {
    const questionId = question.id;
    const skippedForSourceCheck = () => ({
      learnerResponse: undefined,
      responseDto: new CreateQuestionResponseAttemptResponseDto(),
    });
    if (
      sourceCheckOnly &&
      question.type !== QuestionType.URL &&
      question.type !== QuestionType.LINK_FILE &&
      question.type !== QuestionType.UPLOAD
    ) {
      return skippedForSourceCheck();
    }

    if (question.type === QuestionType.TEXT) {
      this.removeImagesFromTextResponse(
        requestDto,
        questionId,
        assignmentId,
        assignmentAttemptId,
        role,
      );
    }

    if (this.isEmptyResponse(requestDto)) {
      const { responseDto, learnerResponse } =
        this.handleEmptyResponse(language);
      responseDto.questionId = questionId;
      responseDto.question = question.question;
      return { learnerResponse, responseDto };
    }

    if (role === UserRole.LEARNER) {
      this.assertLearnerFilesBelongToQuestion(
        requestDto.learnerFileResponse,
        assignmentId,
        assignmentAttemptId,
        questionId,
        userId,
      );
    }

    const gradingContext: GradingContext = {
      assignmentInstructions: assignmentContext.assignmentInstructions,
      questionAnswerContext: assignmentContext.questionAnswerContext,
      assignmentId,
      language,
      userRole: role,
      userId,
      attemptId: assignmentAttemptId,
      sourceCheckOnly,
      metadata: {
        attemptId: assignmentAttemptId,
        questionType: question.type,
        responseType: question.responseType,
      },
    };

    if (
      role === UserRole.LEARNER &&
      (question.type === QuestionType.SINGLE_CORRECT ||
        question.type === QuestionType.MULTIPLE_CORRECT)
    ) {
      gradingContext.loadChoiceRenderings = () =>
        this.loadChoiceRenderings(questionId, assignmentAttemptId);
    }

    let responseDto: CreateQuestionResponseAttemptResponseDto;
    let learnerResponse: unknown;

    try {
      if (question.type === QuestionType.LINK_FILE) {
        ({ responseDto, learnerResponse } = await this.handleLinkFileQuestion(
          question,
          requestDto,
          gradingContext,
        ));
      } else {
        const startTime = Date.now();

        this.logger.info("Starting question grading process", {
          questionId,
          questionType: question.type,
          responseType: question.responseType,
          assignmentId,
          assignmentAttemptId,
          userRole: role,
          language,
        });

        const gradingStrategy = this.gradingFactoryService.getStrategy(
          question.type,
          question.responseType,
          requestDto.learnerFileResponse,
        );

        if (!gradingStrategy) {
          this.logger.error("No grading strategy found", {
            questionId,
            questionType: question.type,
            responseType: question.responseType,
          });
          throw new BadRequestException(
            `No grading strategy found for question type: ${question.type}`,
          );
        }

        this.logger.info("Using grading strategy", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
          questionType: question.type,
          responseType: question.responseType,
        });

        if (sourceCheckOnly && !gradingStrategy.supportsSourceCheck) {
          return skippedForSourceCheck();
        }

        this.logger.debug("Validating response", { questionId });
        const isValid = await gradingStrategy.validateResponse(
          question,
          requestDto,
        );

        if (!isValid) {
          this.logger.warn("Response validation failed", {
            questionId,
            language: requestDto.language,
            strategyName: gradingStrategy.constructor.name,
          });
          throw new BadRequestException(
            `Invalid response for question ID ${questionId}: ${requestDto.language}`,
          );
        }

        this.logger.debug("Extracting learner response", { questionId });
        learnerResponse =
          await gradingStrategy.extractLearnerResponse(requestDto);

        this.logger.info("Grading response with strategy", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
        });

        responseDto = await gradingStrategy.gradeResponse(
          question,
          learnerResponse,
          gradingContext,
        );

        if (!responseDto) {
          this.logger.error("Strategy returned null/undefined response", {
            questionId,
            strategyName: gradingStrategy.constructor.name,
          });
          throw new BadRequestException(
            `Failed to grade response for question ID ${questionId}`,
          );
        }

        const duration = Date.now() - startTime;
        this.logger.info("Successfully completed question grading", {
          questionId,
          strategyName: gradingStrategy.constructor.name,
          totalPoints: responseDto.totalPoints,
          maxPoints: question.totalPoints,
          duration,
          feedback: responseDto.feedback ? "present" : "missing",
        });
      }
    } catch (error: unknown) {
      // Typed learner-facing terminal errors must keep their identity: the
      // job worker classifies them by class/name to fail the attempt without
      // retries and surface their learner-facing message. Wrapping them in
      // BadRequestException erased that.
      if (error instanceof LearnerFacingGradingError) {
        throw error;
      }

      // Same reasoning as above: a rate-limited or otherwise transient URL
      // fetch is a system fault the caller must be able to retry, not a 400.
      // Wrapping it here would erase the class identity the retry
      // classification depends on.
      if (
        error instanceof RetryableUrlFetchError ||
        error instanceof RetryableProcessingError
      ) {
        throw error;
      }

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error("Failed to process question response", {
        questionId,
        questionType: question.type,
        responseType: question.responseType,
        assignmentId,
        assignmentAttemptId,
        userRole: role,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      throw new BadRequestException(
        `Failed to process question response: ${errorMessage}`,
      );
    }

    return { learnerResponse, responseDto };
  }

  /**
   * Grading reads uploaded files from storage by the coordinates in the
   * answer, so they must point at this learner's own upload for this
   * question: a learner bucket and a key under
   * `<assignmentId>/<userId>/<questionId>/`.
   */
  private assertLearnerFilesBelongToQuestion(
    files: CreateQuestionResponseAttemptRequestDto["learnerFileResponse"],
    assignmentId: number,
    assignmentAttemptId: number,
    questionId: number,
    userId: string | undefined,
  ): void {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }
    const denial = findLearnerFileReferenceDenial(files, {
      assignmentId,
      userId: userId ?? "",
      questionId,
      allowedBuckets: S3Service.learnerUploadBuckets(),
    });
    if (denial) {
      this.logger.warn("grading.file_reference.rejected", {
        assignment_id: assignmentId,
        attempt_id: assignmentAttemptId,
        user_id: userId,
        question_id: questionId,
        denial_reason: denial,
      });
      throw new InvalidLearnerFileReferenceException();
    }
  }

  /**
   * Every stored set of choices the learner can have been shown for this
   * question in this attempt: the authored choices of the question or its
   * drawn variant, and their stored translations. Read from the database by
   * attempt and question, never from the request.
   */
  private async loadChoiceRenderings(
    questionId: number,
    assignmentAttemptId: number,
  ): Promise<ChoiceRendering[]> {
    const [question, mapping] = await Promise.all([
      this.prisma.question.findUnique({
        where: { id: questionId },
        select: { choices: true },
      }),
      this.prisma.assignmentAttemptQuestionVariant.findUnique({
        where: {
          assignmentAttemptId_questionId: { assignmentAttemptId, questionId },
        },
        select: { questionVariant: { select: { id: true, choices: true } } },
      }),
    ]);

    const variant = mapping?.questionVariant ?? null;
    const variantId = variant?.id ?? null;
    const baseChoices = parseStoredChoices(question?.choices);
    const ownChoices =
      (variant ? parseStoredChoices(variant.choices) : undefined) ??
      baseChoices;

    const rows = await this.prisma.translation.findMany({
      where: {
        questionId,
        OR: [{ variantId: null }, ...(variantId ? [{ variantId }] : [])],
      },
      select: {
        languageCode: true,
        variantId: true,
        translatedChoices: true,
        untranslatedChoices: true,
      },
    });

    const renderings = buildChoiceRenderings({
      ownChoices,
      baseChoices,
      variantId,
      rows,
    });

    this.logger.debug("Loaded stored choice renderings", {
      questionId,
      assignmentAttemptId,
      variantId,
      translationRows: rows.length,
      renderings: renderings.map((rendering) => rendering.source),
    });

    return renderings;
  }

  /**
   * Handle LINK_FILE question type which can accept either URL or File
   */
  private async handleLinkFileQuestion(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    gradingContext: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: any;
  }> {
    if (requestDto.learnerUrlResponse) {
      const urlGradingStrategy = this.gradingFactoryService.getStrategy(
        QuestionType.URL,
      );
      // Normalize first: the blob-to-raw rewrite below only recognises a
      // fully-qualified https://github.com/... URL, so a link the learner
      // pasted without a scheme would otherwise skip it entirely.
      const url =
        normalizeLearnerUrl(requestDto.learnerUrlResponse) ||
        requestDto.learnerUrlResponse;
      requestDto.learnerUrlResponse = url;
      const rawUrl = convertGitHubUrlToRaw(url);
      if (rawUrl) {
        requestDto.learnerUrlResponse = rawUrl;
      }
      const isValid = await urlGradingStrategy.validateResponse(
        question,
        requestDto,
      );
      if (!isValid) {
        throw new BadRequestException(
          `Invalid URL response for question ID ${question.id}: ${requestDto.language}`,
        );
      }
      const learnerResponse =
        await urlGradingStrategy.extractLearnerResponse(requestDto);
      const responseDto = await urlGradingStrategy.gradeResponse(
        question,
        learnerResponse,
        gradingContext,
      );
      return { responseDto, learnerResponse };
    } else if (requestDto.learnerFileResponse) {
      let responseType: string | undefined;
      if (question.responseType === "IMAGES") {
        responseType = question.responseType;
      }
      const fileGradingStrategy = this.gradingFactoryService.getStrategy(
        QuestionType.UPLOAD,
        responseType,
        requestDto.learnerFileResponse,
      );
      if (
        gradingContext.sourceCheckOnly &&
        !fileGradingStrategy.supportsSourceCheck
      ) {
        return {
          learnerResponse: undefined,
          responseDto: new CreateQuestionResponseAttemptResponseDto(),
        };
      }
      const isValid = await fileGradingStrategy.validateResponse(
        question,
        requestDto,
      );
      if (!isValid) {
        throw new BadRequestException(
          `Invalid file response for question ID ${question.id}: ${requestDto.language}`,
        );
      }
      const learnerResponse =
        await fileGradingStrategy.extractLearnerResponse(requestDto);
      const responseDto = await fileGradingStrategy.gradeResponse(
        question,
        learnerResponse,
        gradingContext,
      );
      return { responseDto, learnerResponse };
    }

    throw new BadRequestException(
      "Expected a file-based or URL-based response, but did not receive one.",
    );
  }

  /**
   * Save a question response to the database
   */
  private async saveResponseToDatabase(
    assignmentAttemptId: number,
    questionId: number,
    learnerResponse: any,
    responseDto: CreateQuestionResponseAttemptResponseDto,
    role: UserRole,
    tx?: PrismaTransactionalClient,
  ): Promise<void> {
    const prisma = tx ?? this.prisma;
    try {
      type FeedbackWithUrl = { annotatedPdfUrl?: string };
      const feedbackArray: FeedbackWithUrl[] = Array.isArray(
        responseDto.feedback,
      )
        ? (responseDto.feedback as FeedbackWithUrl[])
        : [];
      const annotatedPdfUrls = feedbackArray
        .map((feedback) => feedback.annotatedPdfUrl)
        .filter((url): url is string => typeof url === "string");
      const hasAnnotatedPdf = annotatedPdfUrls.length > 0;
      if (hasAnnotatedPdf) {
        this.logger.info(
          "[saveResponseToDatabase] Saving response with annotatedPdfUrl",
          {
            questionId,
            attemptId: assignmentAttemptId,
            feedbackCount: feedbackArray.length,
            annotatedPdfUrls,
          },
        );
      }

      // Sanitize the raw values BEFORE stringifying: JSON.stringify escapes
      // NUL to the literal sequence `\u0000`, which the scrubber would then
      // miss but Postgres jsonb still rejects (SqlState 22P05).
      const learnerResponseClean = sanitizeUnicodeForJson(
        JSON.parse(JSON.stringify(learnerResponse ?? "")) as unknown,
      );
      const learnerResponseJson = {
        value: JSON.stringify(learnerResponseClean.value),
        replaced: learnerResponseClean.replaced,
      };
      const feedbackClean = sanitizeUnicodeForJson(
        JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      );
      const metadataClean = responseDto.metadata
        ? sanitizeUnicodeForJson(
            JSON.parse(JSON.stringify(responseDto.metadata)) as object,
          )
        : null;
      const metadataJson = metadataClean
        ? {
            value: JSON.stringify(metadataClean.value),
            replaced: metadataClean.replaced,
          }
        : null;
      const totalReplaced =
        learnerResponseJson.replaced +
        feedbackClean.replaced +
        (metadataJson?.replaced ?? 0);
      if (totalReplaced > 0) {
        this.logger.warn(
          "[saveResponseToDatabase] Replaced lone UTF-16 surrogates before write",
          {
            questionId,
            attemptId: assignmentAttemptId,
            replacements: totalReplaced,
          },
        );
      }

      const result = await prisma.questionResponse.create({
        data: {
          assignmentAttemptId:
            role === UserRole.LEARNER ? assignmentAttemptId : 1,
          questionId: questionId,
          learnerResponse: learnerResponseJson.value,
          points: responseDto.totalPoints ?? 0,
          feedback: feedbackClean.value,
          metadata: metadataJson?.value ?? null,
          gradedAt: new Date(),
        },
      });

      // Instrumentation wrapping the Prisma client can resolve a failed
      // create with the Error object instead of rejecting; treat anything
      // without a numeric id as the failure it is so the commit aborts.
      if (typeof result?.id !== "number") {
        throw new InternalServerErrorException(
          `QuestionResponse create for attempt ${assignmentAttemptId} question ${questionId} returned no id.`,
        );
      }

      responseDto.id = result.id;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error("Failed to save question response", {
        questionId,
        assignmentAttemptId,
        role,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new InternalServerErrorException(
        `Failed to save question response: ${errorMessage}`,
      );
    }
  }

  /**
   * Get question and context information for a learner
   */
  private async getLearnerQuestion(
    questionId: number,
    assignmentAttemptId: number,
    assignmentId: number,
    preTranslatedQuestions?: Map<number, QuestionDto>,
    tx?: PrismaTransactionalClient,
    cache?: JobScopedCache,
    language?: string,
  ): Promise<{
    question: QuestionDto;
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
  }> {
    const prisma = tx ?? this.prisma;
    if (preTranslatedQuestions && preTranslatedQuestions.has(questionId)) {
      const question = preTranslatedQuestions.get(questionId);
      const assignmentContext = await this.getAssignmentContext(
        assignmentId,
        questionId,
        assignmentAttemptId,
        tx,
        undefined,
        cache,
      );
      return { question, assignmentContext };
    }

    const assignmentAttempt = await prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionVariants: {
          select: {
            questionId: true,
            questionVariant: { include: { variantOf: true } },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    const variantMapping = assignmentAttempt.questionVariants.find(
      (qv) => qv.questionId === questionId,
    );

    // An attempt pinned to an assignment version is graded against that
    // version's question, the one the learner was shown; the live row only
    // stands in for attempts without a pinned version.
    const pinnedQuestion = cache?.pinnedQuestions?.get(questionId);
    const baseQuestion: QuestionDto =
      pinnedQuestion ??
      (variantMapping?.questionVariant
        ? this.liveBaseQuestion(variantMapping.questionVariant.variantOf)
        : await this.questionService.findOne(questionId, tx, cache));
    if (cache?.pinnedQuestions && !pinnedQuestion) {
      this.logger.warn("grading.question.not_in_pinned_version", {
        assignment_id: assignmentId,
        attempt_id: assignmentAttemptId,
        question_id: questionId,
      });
    }

    let question: QuestionDto =
      variantMapping && variantMapping.questionVariant !== null
        ? applyVariantToQuestion(baseQuestion, variantMapping.questionVariant)
        : baseQuestion;

    if (language && language !== "en") {
      const variantId = variantMapping?.questionVariant?.id ?? null;
      const key = buildTranslationCacheKey(language, questionId, variantId);
      let translation = cache?.translations.get(key);
      if (!cache?.translations.has(key)) {
        translation =
          (await findQuestionTranslation(
            prisma,
            questionId,
            variantId,
            language,
          )) ?? null;
        cache?.translations.set(key, translation);
      }
      question = applyQuestionTranslation(question, translation);
    }

    const assignmentContext = await this.getAssignmentContext(
      assignmentId,
      questionId,
      assignmentAttemptId,
      tx,
      undefined,
      cache,
    );

    return { question, assignmentContext };
  }

  /** A variant's live base question, for attempts without a pinned version. */
  private liveBaseQuestion(baseQuestion: Question): QuestionDto {
    return {
      id: baseQuestion.id,
      question: baseQuestion.question,
      type: baseQuestion.type,
      assignmentId: baseQuestion.assignmentId,
      maxWords: baseQuestion.maxWords,
      maxCharacters: baseQuestion.maxCharacters,
      scoring: this.parseJsonField(baseQuestion.scoring) as ScoringDto,
      choices: this.parseJsonField(baseQuestion.choices) as Choice[],
      answer: baseQuestion.answer,
      alreadyInBackend: true,
      totalPoints: baseQuestion.totalPoints,
      responseType: baseQuestion.responseType,
      gradingContextQuestionIds: baseQuestion.gradingContextQuestionIds ?? [],
      videoPresentationConfig: baseQuestion.videoPresentationConfig
        ? (this.parseJsonField(
            baseQuestion.videoPresentationConfig,
          ) as VideoPresentationConfig)
        : null,
    };
  }

  /**
   * Get question and context information for an author
   */
  private getAuthorQuestion(
    questionId: number,
    authorQuestions: QuestionDto[],
    assignmentDetails: any,
  ): {
    question: QuestionDto;
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
  } {
    const question = authorQuestions.find((q) => q.id === questionId);

    if (!question) {
      throw new NotFoundException(
        `Question with ID ${questionId} not found in author questions.`,
      );
    }

    const assignmentContext = {
      assignmentInstructions: assignmentDetails?.instructions ?? "",
      questionAnswerContext: [],
    };

    return { question, assignmentContext };
  }

  /**
   * Get assignment context for grading.
   *
   * @param inMemoryResponses - Optional map of questionId → JSON-stringified learnerResponse.
   *   When provided (Phase 2 grading), context responses are read from memory instead of the
   *   database so we don't need to write them first.
   */
  private async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
    tx?: PrismaTransactionalClient,
    inMemoryResponses?: Map<number, string>,
    cache?: JobScopedCache,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    const prisma = tx ?? this.prisma;

    let assignment = cache?.assignment;
    if (!assignment) {
      const fetched = await prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { instructions: true },
      });
      if (!fetched) {
        throw new NotFoundException(
          `Assignment with ID ${assignmentId} not found.`,
        );
      }
      assignment = fetched;
      if (cache) cache.assignment = fetched;
    }

    let gradingContextQuestionIds: number[];
    const pinnedQuestion = cache?.pinnedQuestions?.get(questionId);
    const cachedQuestion = cache?.questions.get(questionId);
    if (pinnedQuestion) {
      gradingContextQuestionIds = pinnedQuestion.gradingContextQuestionIds;
    } else if (cachedQuestion) {
      gradingContextQuestionIds = cachedQuestion.gradingContextQuestionIds;
    } else {
      const fetched = await prisma.question.findUnique({
        where: { id: questionId },
        select: { gradingContextQuestionIds: true },
      });
      if (!fetched) {
        throw new NotFoundException(
          `Question with ID ${questionId} not found.`,
        );
      }
      gradingContextQuestionIds = fetched.gradingContextQuestionIds;
    }

    if (!gradingContextQuestionIds || gradingContextQuestionIds.length === 0) {
      return {
        assignmentInstructions: assignment.instructions || "",
        questionAnswerContext: [],
      };
    }

    const pinnedContextQuestions = cache?.pinnedQuestions
      ? gradingContextQuestionIds
          .map((id) => cache.pinnedQuestions?.get(id))
          .filter((q): q is QuestionDto => q !== undefined)
          .map((q) => ({ id: q.id, question: q.question, type: q.type }))
      : [];
    const pinnedContextIds = new Set(pinnedContextQuestions.map((q) => q.id));
    const unpinnedContextIds = gradingContextQuestionIds.filter(
      (id) => !pinnedContextIds.has(id),
    );
    const contextQuestions = [
      ...pinnedContextQuestions,
      ...(unpinnedContextIds.length > 0
        ? await prisma.question.findMany({
            where: {
              id: {
                in: unpinnedContextIds,
              },
            },
            select: { id: true, question: true, type: true },
          })
        : []),
    ];

    // Build the response lookup: prefer in-memory (Phase 2) over DB
    const responsesByQuestionId: Record<number, string> = {};
    if (inMemoryResponses && inMemoryResponses.size > 0) {
      for (const contextQ of contextQuestions) {
        const inMemory = inMemoryResponses.get(contextQ.id);
        if (inMemory !== undefined) {
          responsesByQuestionId[contextQ.id] = inMemory;
        }
      }
    }

    // Fall back to DB for any context questions not yet in memory
    const missingIds = contextQuestions
      .filter((contextQ) => responsesByQuestionId[contextQ.id] === undefined)
      .map((contextQ) => contextQ.id);

    if (missingIds.length > 0) {
      const questionResponses = await prisma.questionResponse.findMany({
        where: {
          assignmentAttemptId: assignmentAttemptId,
          questionId: { in: missingIds },
        },
        orderBy: { id: "desc" },
      });

      const seenIds = new Set<number>();
      for (const response of questionResponses) {
        if (!seenIds.has(response.questionId)) {
          seenIds.add(response.questionId);
          responsesByQuestionId[response.questionId] = response.learnerResponse;
        }
      }
    }

    const questionAnswerContext = await Promise.all(
      contextQuestions.map(async (contextQuestion) => {
        let learnerResponse = responsesByQuestionId[contextQuestion.id] || "";

        if (contextQuestion.type === QuestionType.URL && learnerResponse) {
          try {
            let urlValue: string | { url: string };
            if (typeof learnerResponse === "string") {
              urlValue = this.isJsonString(learnerResponse)
                ? (JSON.parse(learnerResponse) as { url: string })
                : learnerResponse;
            } else {
              urlValue = learnerResponse as { url: string };
            }

            const url =
              typeof urlValue === "object" ? urlValue.url : String(urlValue);

            const content = await fetchUrlContentForGrading(String(url), {
              assignmentId,
              questionId: contextQuestion.id,
            });

            learnerResponse = JSON.stringify({
              url,
              content: content.body,
              isFunctional: content.isFunctional,
            });
          } catch {
            // Ignore URL fetch failures while building learner context.
          }
        }

        return {
          question: contextQuestion.question,
          answer: learnerResponse,
          questionId: contextQuestion.id,
          questionType: contextQuestion.type,
        };
      }),
    );

    return {
      assignmentInstructions: assignment.instructions || "",
      questionAnswerContext,
    };
  }

  /**
   * Check if a string is valid JSON
   */
  private isJsonString(string_: string): boolean {
    try {
      JSON.parse(string_);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Text questions are graded on text alone, so an image pasted into the
   * answer is invisible to the grader and only bloats the stored response.
   * The learner editor blocks images; this covers any client that does not.
   * The submission is still accepted, with whatever text remains.
   */
  private removeImagesFromTextResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
    questionId: number,
    assignmentId: number,
    assignmentAttemptId: number,
    role: UserRole,
  ): void {
    if (typeof requestDto.learnerTextResponse !== "string") return;

    const { html, removedCount } = stripImagesFromLearnerHtml(
      requestDto.learnerTextResponse,
    );
    if (removedCount === 0) return;

    this.logger.warn("Removed images from a text answer before grading", {
      assignmentId,
      assignmentAttemptId,
      questionId,
      userRole: role,
      removedImageCount: removedCount,
      originalLength: requestDto.learnerTextResponse.length,
      remainingLength: html.length,
      imageOnly: html.length === 0,
    });
    requestDto.learnerTextResponse = html;
  }

  /**
   * Check if a response is empty
   */
  private isEmptyResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): boolean {
    return (
      (!requestDto.learnerFileResponse ||
        requestDto.learnerFileResponse.length === 0) &&
      (!requestDto.learnerUrlResponse ||
        (typeof requestDto.learnerUrlResponse === "string" &&
          requestDto.learnerUrlResponse.trim() === "")) &&
      (!requestDto.learnerTextResponse ||
        (typeof requestDto.learnerTextResponse === "string" &&
          requestDto.learnerTextResponse.trim() === "")) &&
      (!requestDto.learnerChoices || requestDto.learnerChoices.length === 0) &&
      (requestDto.learnerAnswerChoice === null ||
        requestDto.learnerAnswerChoice === undefined) &&
      (!requestDto.learnerPresentationResponse ||
        (Array.isArray(requestDto.learnerPresentationResponse) &&
          requestDto.learnerPresentationResponse.length === 0))
    );
  }

  /**
   * Handle an empty response
   */
  private handleEmptyResponse(language: string): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = 0;

    const noResponseFeedback = new GeneralFeedbackDto();
    noResponseFeedback.feedback = this.localizationService.getLocalizedString(
      "noResponse",
      language,
    );

    responseDto.feedback = [noResponseFeedback];

    return { responseDto, learnerResponse: "" };
  }

  /**
   * Parse a JSON field from a database record. Prisma stores Json columns as
   * the deserialized object/array, but legacy rows occasionally hold a
   * stringified payload — handle both shapes.
   */
  private parseJsonField(field: unknown): unknown {
    if (!field) return null;

    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch {
        return null;
      }
    }

    return field;
  }
}
