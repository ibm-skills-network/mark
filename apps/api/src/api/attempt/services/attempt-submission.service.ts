/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/no-null */
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  AssignmentAttempt,
  AssignmentQuestionDisplayOrder,
  CorrectAnswerVisibility,
  Prisma,
  Question,
  QuestionType,
  QuestionVariant,
  ResponseType,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { BaseAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import {
  LearnerUpdateAssignmentAttemptRequestDto,
  SubmittedQuestionResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { SubmitAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/submit.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { S3Service } from "src/api/files/services/s3.service";
import {
  countAnsweredResponses,
  hasTextContent,
} from "src/api/assignment/attempt/helper/blank-submission.helper";
import { readServerClock } from "src/api/assignment/attempt/helper/server-clock.helper";
import {
  AttemptClosedException,
  EXPIRED_ATTEMPT_COMMENT,
  isFinalSubmitBeforeDeadline,
  wasClosedAtTimeLimit,
} from "src/api/assignment/attempt/helper/submission-deadline.helper";
import {
  GetAssignmentResponseDto,
  LearnerGetAssignmentResponseDto,
} from "src/api/assignment/dto/get.assignment.response.dto";
import {
  AttemptQuestionDto,
  Choice,
  QuestionDto,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VariantDto,
  VariantType,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { applyQuestionOrder } from "src/api/assignment/utils/question-order.util";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../database/prisma.service";
import { RetryableUrlFetchError } from "../../llm/features/grading/errors/retryable-url-fetch.error";
import { LearnerFacingGradingError } from "../../llm/features/grading/errors/learner-facing-grading.error";
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "../common/utils/attempt-questions-mapper.util";
import { toLearnerAttemptQuestion } from "../common/utils/learner-attempt-shape.util";
import {
  DEFAULT_PASSING_GRADE,
  meetsPassingGrade,
  resolvePassedIndicator,
} from "../common/utils/pass-fail.util";
import { CompletedAttemptResponseDto } from "../dto/completed-attempt.response.dto";
import { LearnerAttemptResponseDto } from "../dto/learner-attempt.response.dto";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptGradingService } from "./attempt-grading.service";
import {
  AttemptValidationService,
  activeAttemptWhere,
} from "./attempt-validation.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
import { type GradingProgressDetails } from "./grading-progress.service";
import {
  newJobScopedCache,
  type JobScopedCache,
} from "./grading/job-scoped-cache";
import {
  GradedItem,
  QuestionResponseService,
} from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";
import {
  isMediaResponseType,
  pinnedQuestionMap,
} from "../common/utils/grading-question-source.util";
import {
  findLearnerFileReferenceDenial,
  NoGradableQuestionsException,
  InvalidLearnerFileReferenceException,
  UnsupportedResponseTypeException,
} from "../common/utils/learner-file-reference.util";
import {
  buildSubmitResult,
  closedAtTimeLimitResult,
} from "../common/utils/submit-result.util";

/** Whether an attempt still accepts a submit, read with a fresh clock. */
export interface AttemptSubmissionStatusDto {
  id: number;
  submitted: boolean;
  closedAtTimeLimit: boolean;
  acceptingSubmissions: boolean;
  expiresAt: string | null;
  serverNow: string;
}

/** What a learner submit grades; see resolveSubmitPlan. */
interface SubmitPlan {
  assignment: Prisma.AssignmentGetPayload<{
    include: {
      questions: true;
      currentVersion: { select: { correctAnswerVisibility: true } };
    };
  }>;
  /** Pinned question DTOs by id, or null for an attempt without a version. */
  pinnedQuestions: Map<number, QuestionDto> | null;
  servedQuestionIds: number[];
  /** Served questions minus media response types, in served order. */
  gradedQuestionIds: number[];
  /** One response per graded question; missing ones are empty answers. */
  responses: SubmittedQuestionResponseDto[];
  /** Sum of totalPoints over the graded questions. */
  totalPossiblePoints: number;
}

type QuestionPointsSource =
  | Pick<Question, "id" | "totalPoints">
  | Pick<QuestionDto, "id" | "totalPoints">;

@Injectable()
export class AttemptSubmissionService {
  private readonly logger = new Logger(AttemptSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: AttemptValidationService,
    private readonly gradingService: AttemptGradingService,
    private readonly attemptAccessCacheService: AttemptAccessCacheService,
    private readonly questionResponseService: QuestionResponseService,
    private readonly translationService: TranslationService,
    private readonly questionVariantService: QuestionVariantService,
    private readonly ltiGradeSyncService: LtiGradeSyncService,
  ) {}

  /**
   * Creates a new assignment attempt
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    const now = new Date();

    const existingAttempt = await this.findResumableAttempt(
      assignmentId,
      userSession.userId,
      now,
    );

    if (existingAttempt) {
      return {
        id: existingAttempt.id,
        success: true,
        serverNow: readServerClock(),
      };
    }

    // Ordered by id so the question pool (and variant draw) is deterministic.
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        currentVersion: {
          include: {
            questionVersions: { orderBy: { id: "asc" } },
          },
        },
        questions: {
          where: { isDeleted: false },
          orderBy: { id: "asc" },
          include: {
            variants: {
              where: { isDeleted: false },
              orderBy: { id: "asc" },
            },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }

    const assignmentForAttemptFlow = {
      ...assignment,
      success: true,
    } as GetAssignmentResponseDto;

    // Attempt creation must be idempotent. The learner questions page creates
    // an attempt as a render side effect, so overlapping renders (or an LMS
    // iframe reload right after submit) can race this endpoint: both read an
    // empty attempt list, both POST, and the loser used to get a 422 or mint a
    // duplicate. Serialize creation per learner+assignment with a
    // transaction-scoped advisory lock; the loser re-checks under the lock and
    // resumes the winner's attempt instead. The loser's wait on the lock
    // counts against the interactive-transaction timeout, so the budget must
    // cover the winner's validation + creation too — the default 5s is not
    // enough headroom under load.
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userSession.userId}:${assignmentId}`}, 0))`;

        const concurrentAttempt = await this.findResumableAttempt(
          assignmentId,
          userSession.userId,
          now,
          tx,
        );

        if (concurrentAttempt) {
          this.logger.warn(
            `createAssignmentAttempt: concurrent creation resolved by resume assignment=${assignmentId} user=${userSession.userId} attempt=${concurrentAttempt.id}`,
          );
          return {
            id: concurrentAttempt.id,
            success: true,
            serverNow: readServerClock(),
          };
        }

        await this.validationService.validateNewAttempt(
          assignmentForAttemptFlow,
          userSession,
          tx,
        );

        return this.createAttemptWithQuestions(
          tx,
          assignmentId,
          assignment,
          assignmentForAttemptFlow,
          userSession,
        );
      },
      { maxWait: 5000, timeout: 15_000 },
    );
  }

  /**
   * The latest unsubmitted, unexpired attempt for this learner+assignment, if
   * one exists. Backs both the pre-lock fast path and the under-lock re-check
   * that makes attempt creation idempotent.
   */
  private async findResumableAttempt(
    assignmentId: number,
    userId: string,
    now: Date,
    database: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    return database.assignmentAttempt.findFirst({
      where: activeAttemptWhere(assignmentId, userId, now),
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Inserts the attempt row and populates its question order and variant
   * picks. Only call with the per-learner+assignment advisory lock held (see
   * createAssignmentAttempt) so concurrent creators serialize.
   */
  private async createAttemptWithQuestions(
    tx: Prisma.TransactionClient,
    assignmentId: number,
    assignment: Prisma.AssignmentGetPayload<{
      include: {
        currentVersion: { include: { questionVersions: true } };
        questions: { include: { variants: true } };
      };
    }>,
    assignmentForAttemptFlow: GetAssignmentResponseDto,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    const attemptExpiresAt = this.calculateAttemptExpiresAt(
      assignmentForAttemptFlow,
    );
    const activeVersionId = assignment.currentVersionId;

    const assignmentAttempt = await tx.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt ?? null,
        submitted: false,
        assignmentId,
        assignmentVersionId: activeVersionId,
        grade: undefined,
        userId: userSession.userId,
        questionOrder: [],
      },
    });

    const selectionSeed = assignmentAttempt.id ^ assignmentId;
    const orderingSeed = Math.imul(selectionSeed, 2_654_435_761) >>> 0;

    let questions: QuestionDto[] = [];
    if (assignment.currentVersion?.questionVersions?.length > 0) {
      const variantsByQuestionId = new Map<number, QuestionVariant[]>();
      for (const question of assignment.questions) {
        variantsByQuestionId.set(question.id, question.variants || []);
      }

      questions = assignment.currentVersion.questionVersions.map((qv) => {
        const variants = qv.questionId
          ? (variantsByQuestionId.get(qv.questionId) ?? [])
          : [];

        return {
          id: qv.questionId || qv.id,
          question: qv.question,
          type: qv.type,
          assignmentId: assignmentId,
          totalPoints: qv.totalPoints,
          maxWords: qv.maxWords,
          maxCharacters: qv.maxCharacters,
          choices: qv.choices as unknown as Choice[],
          scoring: qv.scoring as unknown as ScoringDto,
          answer: qv.answer,
          variants: variants.map(
            (v: QuestionVariant): VariantDto => ({
              id: v.id,
              variantContent: v.variantContent,
              choices: v.choices as unknown as Choice[],
              scoring: v.scoring as unknown as ScoringDto,
              maxWords: v.maxWords || undefined,
              maxCharacters: v.maxCharacters || undefined,
              variantType: v.variantType as VariantType,
              randomizedChoices: v.randomizedChoices || undefined,
              isDeleted: v.isDeleted || false,
            }),
          ),
          gradingContextQuestionIds: qv.gradingContextQuestionIds,
          responseType: qv.responseType,
          isDeleted: false,
          randomizedChoices: qv.randomizedChoices,
          videoPresentationConfig:
            qv.videoPresentationConfig as unknown as VideoPresentationConfig,
          liveRecordingConfig: qv.liveRecordingConfig as object,
        };
      });
    } else {
      questions = (assignment.questions || []).map((q) => ({
        ...q,
        scoring: q.scoring as unknown as ScoringDto,
        choices: q.choices as unknown as Choice[],
        videoPresentationConfig:
          q.videoPresentationConfig as unknown as VideoPresentationConfig,
        liveRecordingConfig: q.liveRecordingConfig as object,
        variants: (q.variants || []).map((v: QuestionVariant) => ({
          ...v,
          choices: v.choices as unknown as Choice[],
          scoring: v.scoring as unknown as ScoringDto,
        })),
      })) as QuestionDto[];
    }

    const requestedPerAttempt = assignment.numberOfQuestionsPerAttempt ?? 0;
    if (requestedPerAttempt > 0) {
      // The pool can be smaller than the requested subset: assignments
      // published before the authoring guards landed still carry oversized
      // counts, and any pool can shrink afterwards (soft-deleted questions, a
      // version snapshot with fewer questions than the live pool). Serving
      // every question is exactly what 0/null already means, so clamp instead
      // of throwing — the old NotFoundException locked every learner out of
      // the assignment with nothing they could do about it.
      if (requestedPerAttempt > questions.length) {
        this.logger.warn(
          `createAssignmentAttempt: numberOfQuestionsPerAttempt (${requestedPerAttempt}) exceeds the ${questions.length}-question pool for assignment=${assignmentId}; serving the whole pool`,
        );
      }
      questions = this.deterministicShuffle(questions, selectionSeed).slice(
        0,
        Math.min(requestedPerAttempt, questions.length),
      );
    }
    const questionDtos: QuestionDto[] = questions.map((q: QuestionDto) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      assignmentId: q.assignmentId,
      totalPoints: q.totalPoints,
      maxWords: q.maxWords || undefined,
      maxCharacters: q.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(q.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(q.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer: (() => {
        if (typeof q.answer === "boolean") {
          return q.answer;
        }
        if (q.answer === "true") {
          return true;
        }
        if (q.answer === "false") {
          return false;
        }
        return;
      })(),
      variants: q.variants,
      gradingContextQuestionIds: q.gradingContextQuestionIds || [],
      responseType: q.responseType || undefined,
      isDeleted: q.isDeleted,
      randomizedChoices:
        typeof q.randomizedChoices === "boolean"
          ? q.randomizedChoices
          : typeof q.randomizedChoices === "string"
            ? q.randomizedChoices === "true"
            : false,
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          q.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        q.liveRecordingConfig,
        null,
      ),
    }));

    const orderedQuestions = this.getOrderedQuestions(
      questionDtos,
      assignmentForAttemptFlow,
      orderingSeed,
    );

    await tx.assignmentAttempt.update({
      where: { id: assignmentAttempt.id },
      data: {
        questionOrder: orderedQuestions.map((q) => q.id),
      },
    });

    await this.questionVariantService.createAttemptQuestionVariants(
      assignmentAttempt.id,
      orderedQuestions,
      tx,
    );

    return {
      id: assignmentAttempt.id,
      success: true,
      serverNow: readServerClock(),
    };
  }

  /**
   * Discards a pristine attempt that is pinned to a stale assignment version,
   * so the learner can immediately create a fresh attempt against the current
   * one. Hard-deletes the row (and its cascade-linked variant selections); the
   * gates below ensure no graded data is destroyed.
   */
  async abandonAssignmentAttempt(
    attemptId: number,
    userSession: UserSession,
  ): Promise<{ id: number; success: true }> {
    this.logger.log(
      `abandonAssignmentAttempt: request attempt=${attemptId} user=${userSession.userId}`,
    );

    const attempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        userId: true,
        assignmentId: true,
        assignmentVersionId: true,
        submitted: true,
        _count: {
          select: { questionResponses: true },
        },
      },
    });

    if (!attempt) {
      this.logger.warn(
        `abandonAssignmentAttempt: not found attempt=${attemptId} user=${userSession.userId}`,
      );
      throw new NotFoundException(`Attempt ${attemptId} not found.`);
    }

    if (
      userSession.role !== UserRole.AUTHOR &&
      attempt.userId !== userSession.userId
    ) {
      this.logger.warn(
        `abandonAssignmentAttempt: forbidden attempt=${attemptId} owner=${attempt.userId} caller=${userSession.userId}`,
      );
      throw new NotFoundException(`Attempt ${attemptId} not found.`);
    }

    if (attempt.submitted) {
      this.logger.warn(
        `abandonAssignmentAttempt: already submitted attempt=${attemptId}`,
      );
      throw new UnprocessableEntityException(
        "This attempt has already been submitted.",
      );
    }

    if (attempt._count.questionResponses > 0) {
      this.logger.warn(
        `abandonAssignmentAttempt: has responses attempt=${attemptId} count=${attempt._count.questionResponses}`,
      );
      throw new UnprocessableEntityException(
        "Cannot abandon an attempt that already has saved responses.",
      );
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: attempt.assignmentId },
      select: { currentVersionId: true },
    });

    if (!assignment?.currentVersionId) {
      this.logger.warn(
        `abandonAssignmentAttempt: no published version assignment=${attempt.assignmentId}`,
      );
      throw new UnprocessableEntityException(
        "This assignment has no active version.",
      );
    }

    if (attempt.assignmentVersionId === assignment.currentVersionId) {
      this.logger.warn(
        `abandonAssignmentAttempt: no version drift attempt=${attemptId} version=${attempt.assignmentVersionId}`,
      );
      throw new UnprocessableEntityException(
        "Attempt is already pinned to the current version; no need to abandon.",
      );
    }

    await this.prisma.assignmentAttempt.delete({
      where: { id: attemptId },
    });

    this.logger.log(
      `abandonAssignmentAttempt: discarded attempt=${attemptId} stale_version=${attempt.assignmentVersionId} current_version=${assignment.currentVersionId}`,
    );

    return { id: attemptId, success: true };
  }

  /**
   * Updates an assignment attempt
   */
  async updateAssignmentAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
    progressCallback?: (
      progress: string,
      percentage?: number,
      details?: GradingProgressDetails,
    ) => Promise<void>,
    cache?: JobScopedCache,
    submissionReceivedAt?: Date,
  ): Promise<SubmitAssignmentAttemptResponseDto> {
    const { role, userId } = request.userSession;
    if (role === UserRole.LEARNER) {
      return this.updateLearnerAttempt(
        attemptId,
        assignmentId,
        updateDto,
        authCookie,
        gradingCallbackRequired,
        request,
        progressCallback,
        cache,
        submissionReceivedAt,
      );
    } else if (role === UserRole.AUTHOR) {
      return this.updateAuthorAttempt(
        assignmentId,
        updateDto,
        userId,
        progressCallback,
      );
    } else {
      throw new NotFoundException(
        `User with role ${role} cannot update assignment attempts.`,
      );
    }
  }
  /**
   * A submitted attempt as the learner's results page shows it. Every
   * visibility setting is applied here, key by key; nothing the client
   * receives needs further gating.
   */
  async getLearnerAssignmentAttempt(
    attemptId: number,
    assignmentId: number,
    userSession: UserSession,
  ): Promise<CompletedAttemptResponseDto> {
    const isLearner = userSession.role === UserRole.LEARNER;
    const learnerUserId =
      typeof userSession.userId === "string" && userSession.userId.length > 0
        ? userSession.userId
        : undefined;
    this.logger.debug(
      `getLearnerAssignmentAttempt: attempt=${attemptId} assignment=${assignmentId} role=${userSession.role}`,
    );

    // Scoped to the route's assignment for every role, and to the session's
    // own rows for learners. An open attempt has no results yet, so it reads
    // exactly like one that does not exist.
    const assignmentAttempt =
      isLearner && learnerUserId === undefined
        ? null
        : await this.prisma.assignmentAttempt.findFirst({
            where: {
              id: attemptId,
              assignmentId,
              submitted: true,
              ...(isLearner ? { userId: learnerUserId } : {}),
            },
            include: {
              questionResponses: true,
              questionVariants: {
                include: { questionVariant: { include: { variantOf: true } } },
              },
              assignmentVersion: {
                include: {
                  questionVersions: true,
                },
              },
            },
          });

    if (!assignmentAttempt) {
      this.logger.warn(
        `getLearnerAssignmentAttempt: refused attempt_id=${attemptId} assignment_id=${assignmentId} user_id=${userSession.userId} role=${userSession.role} denial_reason=not_found_unowned_or_unsubmitted`,
      );
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        showPassFailIndicator: true,
        updatedAt: true,
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }

    // Fetch questions before deciding answer visibility: shouldShowCorrectAnswers
    // must use the clamped grade, not the potentially inflated stored one.
    const cachedQuestions =
      await this.attemptAccessCacheService.getQuestionDtosForAttemptAccess({
        assignmentId: assignmentAttempt.assignmentId,
        assignmentUpdatedAt: assignment.updatedAt,
        assignmentVersionId: assignmentAttempt.assignmentVersionId,
        questionVersions:
          assignmentAttempt.assignmentVersion?.questionVersions ?? [],
      });

    // A response must never contribute more than its own question's maximum.
    // Historically some multi-select responses were graded above that max
    // (the correct choices' points summed past the question's totalPoints),
    // which inflated the attempt total to a false 100% and could mask other
    // questions' losses. Clamp per question so already-graded attempts show
    // the learner's real score. New submissions are already correct (the
    // grader clamps at scoring time); this keeps historical attempts honest.
    //
    // Store totalPoints as-is (no ?? 0) so that a question with a null
    // totalPoints is treated as unknown-max (pass through) rather than
    // zero-max, which the > 0 guard would also pass through but misleadingly.
    const questionMaxById = new Map(
      cachedQuestions.map((q) => [q.id, q.totalPoints]),
    );
    const responses = assignmentAttempt.questionResponses ?? [];
    const servedQuestionIds = assignmentAttempt.questionOrder?.length
      ? assignmentAttempt.questionOrder
      : assignment.questionOrder?.length
        ? assignment.questionOrder
        : cachedQuestions.map((q) => q.id);
    const servedQuestionIdSet = new Set(servedQuestionIds);

    // Historical rows and crafted requests can contain duplicate or unserved
    // responses. Keep only the newest served response so the numerator covers
    // the same question set as the denominator.
    const servedResponseByQuestionId = new Map<
      number,
      (typeof responses)[number]
    >();
    for (const response of responses) {
      if (!servedQuestionIdSet.has(response.questionId)) continue;

      const existing = servedResponseByQuestionId.get(response.questionId);
      if (!existing || response.id > existing.id) {
        servedResponseByQuestionId.set(response.questionId, response);
      }
    }
    // Media questions are no longer graded, so, exactly as on submit, an
    // unanswered one counts toward neither total. An attempt graded before
    // that change has a stored response for it, and that response stays in
    // both totals so they describe the same question set as the stored
    // grade. The pinned (cached) question decides the type; a served
    // question missing from it is checked against its row below.
    const isUngradedMedia = (question: {
      id: number;
      responseType?: string | null;
    }) =>
      isMediaResponseType(question.responseType) &&
      !servedResponseByQuestionId.has(question.id);
    const mediaQuestionIds = new Set(
      cachedQuestions
        .filter(
          (question) =>
            servedQuestionIdSet.has(question.id) && isUngradedMedia(question),
        )
        .map((question) => question.id),
    );
    // Totals are computed server-side so the score renders even when
    // showQuestions=false leaves the questions array empty.
    //
    // Scope the denominator to the questions actually served to this attempt.
    // Question-bank assignments draw numberOfQuestionsPerAttempt (< bank size)
    // questions, recorded in assignmentAttempt.questionOrder. Summing every
    // cached question inflates the total to the full bank size (e.g. "15/20"
    // when only 15 were served). Mirror the served-set precedence the
    // questions mapper uses so numerator and denominator cover the same set.
    const missingMaxQuestionIds = [...servedQuestionIdSet].filter(
      (questionId) =>
        !questionMaxById.has(questionId) &&
        this.getResponseMaxPossiblePoints(
          servedResponseByQuestionId.get(questionId)?.metadata ?? null,
        ) === undefined,
    );
    const missingMaxQuestions =
      missingMaxQuestionIds.length > 0
        ? await this.prisma.question.findMany({
            where: { id: { in: missingMaxQuestionIds } },
            select: { id: true, totalPoints: true, responseType: true },
          })
        : [];
    const deletedQuestionMaxById = new Map(
      missingMaxQuestions.map((question) => [
        question.id,
        question.totalPoints,
      ]),
    );
    for (const question of missingMaxQuestions) {
      if (isUngradedMedia(question)) {
        mediaQuestionIds.add(question.id);
      }
    }
    const servedResponses = [...servedResponseByQuestionId.values()].filter(
      (response) => !mediaQuestionIds.has(response.questionId),
    );
    const rawPointsEarned = servedResponses.reduce(
      (sum, response) => sum + (response.points ?? 0),
      0,
    );
    let totalPointsEarned = 0;
    for (const response of servedResponses) {
      const questionMax = questionMaxById.get(response.questionId);
      const points = response.points ?? 0;
      totalPointsEarned +=
        typeof questionMax === "number"
          ? Math.min(points, questionMax)
          : points;
    }
    let totalPossiblePoints = 0;
    for (const questionId of servedQuestionIdSet) {
      if (mediaQuestionIds.has(questionId)) {
        continue;
      }
      if (questionMaxById.has(questionId)) {
        // Question is in the cache: use its defined max (null totalPoints
        // stays 0, matching the historical denominator behavior).
        totalPossiblePoints += questionMaxById.get(questionId) ?? 0;
      } else {
        // Served (in questionOrder) but absent from the cache — normally a
        // soft-deleted question on a non-versioned assignment. Preserve its
        // actual maximum from grading metadata or the archived database row;
        // earned points are not a valid substitute for possible points.
        const responseMax = this.getResponseMaxPossiblePoints(
          servedResponseByQuestionId.get(questionId)?.metadata ?? null,
        );
        const deletedQuestionMax = deletedQuestionMaxById.get(questionId);
        if (responseMax !== undefined) {
          totalPossiblePoints += responseMax;
          continue;
        }
        if (deletedQuestionMax === undefined) {
          throw new InternalServerErrorException(
            `Cannot calculate totalPossiblePoints: served Question ${questionId} ` +
              "is absent from the attempt snapshot and database.",
          );
        }
        totalPossiblePoints += deletedQuestionMax;
      }
    }
    // The grade shown, the pass/fail verdict and ON_PASS answer reveal all
    // derive from this one value: the stored grade, or the clamped ratio when
    // clamping lowered the earned total. The persisted grade and the LTI
    // passback are left untouched; correcting those is a re-grade.
    const effectiveGrade =
      totalPointsEarned < rawPointsEarned &&
      totalPossiblePoints > 0 &&
      assignmentAttempt.grade !== null
        ? totalPointsEarned / totalPossiblePoints
        : assignmentAttempt.grade;

    const correctAnswerVisibility: CorrectAnswerVisibility =
      assignment.currentVersion?.correctAnswerVisibility || "NEVER";
    const passingGrade = assignment.passingGrade ?? DEFAULT_PASSING_GRADE;
    const revealAnswers = this.shouldShowCorrectAnswers(
      correctAnswerVisibility,
      effectiveGrade,
      passingGrade,
    );

    const formattedAttempt: AssignmentAttemptWithRelations = {
      ...assignmentAttempt,
      questionVariants: assignmentAttempt.questionVariants.map((qv) => ({
        questionId: qv.questionId,
        questionVariant: qv.questionVariant
          ? {
              ...qv.questionVariant,
              answer:
                typeof qv.questionVariant.answer === "boolean"
                  ? String(qv.questionVariant.answer)
                  : qv.questionVariant.answer,
              variantOf: qv.questionVariant.variantOf
                ? {
                    ...qv.questionVariant.variantOf,
                    answer:
                      typeof qv.questionVariant.variantOf.answer === "boolean"
                        ? String(qv.questionVariant.variantOf.answer)
                        : qv.questionVariant.variantOf.answer,
                  }
                : undefined,
            }
          : null,
        randomizedChoices:
          typeof qv.randomizedChoices === "string"
            ? qv.randomizedChoices
            : JSON.stringify(qv.randomizedChoices ?? false),
      })),
    };

    const visibility = {
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestions: assignment.showQuestions,
      showQuestionScore: assignment.showQuestionScore,
      showPassFailIndicator: assignment.showPassFailIndicator,
    };
    const questions = visibility.showQuestions
      ? await AttemptQuestionsMapper.buildCompletedQuestions(
          formattedAttempt,
          cachedQuestions,
          { id: assignmentAttempt.assignmentId, ...assignment },
          this.prisma,
          {
            revealAnswers,
            showQuestionScore: visibility.showQuestionScore,
            showSubmissionFeedback: visibility.showSubmissionFeedback,
            responseByQuestionId: servedResponseByQuestionId,
          },
        )
      : [];

    const showScore = visibility.showAssignmentScore;
    const passed = resolvePassedIndicator(
      visibility.showPassFailIndicator,
      effectiveGrade,
      passingGrade,
    );

    this.logger.log(
      `getLearnerAssignmentAttempt: served attempt=${attemptId} assignment=${assignmentId} role=${userSession.role} questions=${questions.length} reveal_answers=${String(revealAnswers)}`,
    );

    // Built key by key: the attempt row carries relations (question versions,
    // variants, every response) that hold the answer key and must not leak.
    return {
      id: assignmentAttempt.id,
      assignmentId: assignmentAttempt.assignmentId,
      submitted: true,
      createdAt: assignmentAttempt.createdAt,
      expiresAt: assignmentAttempt.expiresAt,
      preferredLanguage: assignmentAttempt.preferredLanguage,
      comments: assignmentAttempt.comments,
      serverNow: readServerClock(),
      grade: showScore ? effectiveGrade : null,
      totalPointsEarned: showScore ? totalPointsEarned : null,
      totalPossiblePoints: showScore ? totalPossiblePoints : null,
      passed: passed ?? null,
      passingGrade,
      ...visibility,
      correctAnswerVisibility,
      questions,
    };
  }

  private getResponseMaxPossiblePoints(
    metadata: JsonValue | null,
  ): number | undefined {
    let parsedMetadata: unknown = metadata;
    if (typeof parsedMetadata === "string") {
      try {
        parsedMetadata = JSON.parse(parsedMetadata) as unknown;
      } catch {
        return undefined;
      }
    }

    if (!parsedMetadata || typeof parsedMetadata !== "object") {
      return undefined;
    }

    const maxPossiblePoints = (
      parsedMetadata as { maxPossiblePoints?: unknown }
    ).maxPossiblePoints;
    return typeof maxPossiblePoints === "number" &&
      Number.isFinite(maxPossiblePoints) &&
      maxPossiblePoints >= 0
      ? maxPossiblePoints
      : undefined;
  }

  /**
   * Gets an assignment attempt with language translation support
   */
  async getAssignmentAttempt(
    attemptId: number,
    language?: string,
  ): Promise<LearnerAttemptResponseDto> {
    const normalizedLanguage = this.getNormalizedLanguage(language);

    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        questionResponses: { orderBy: { id: "asc" } },
        questionVariants: {
          orderBy: { questionId: "asc" },
          include: {
            questionVariant: {
              include: {
                variantOf: true,
              },
            },
          },
        },
        assignmentVersion: {
          include: {
            questionVersions: { orderBy: { id: "asc" } },
          },
        },
      },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestions: true,
        showQuestionScore: true,
        updatedAt: true,
        currentVersionId: true,
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
      },
    })) as {
      questionOrder: number[];
      displayOrder: AssignmentQuestionDisplayOrder | null;
      passingGrade: number;
      showAssignmentScore: boolean;
      showSubmissionFeedback: boolean;
      showQuestions: boolean;
      showQuestionScore: boolean;
      updatedAt: Date;
      currentVersionId: number | null;
      currentVersion: {
        correctAnswerVisibility: CorrectAnswerVisibility;
      } | null;
    } | null;

    if (!assignment) {
      this.logger.warn(
        `getAssignmentAttempt: attempt=${attemptId} references missing assignment=${assignmentAttempt.assignmentId}`,
      );
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    const cachedQuestions =
      await this.attemptAccessCacheService.getQuestionDtosForAttemptAccess({
        assignmentId: assignmentAttempt.assignmentId,
        assignmentUpdatedAt: assignment.updatedAt,
        assignmentVersionId: assignmentAttempt.assignmentVersionId,
        questionVersions:
          assignmentAttempt.assignmentVersion?.questionVersions ?? [],
      });

    const questionsForTranslation =
      this.toQuestionDtosForTranslation(cachedQuestions);

    const translations =
      await this.translationService.getTranslationsForAttempt(
        assignmentAttempt,
        questionsForTranslation,
        normalizedLanguage,
      );

    const formattedAttempt: AssignmentAttemptWithRelations = {
      ...assignmentAttempt,
      questionVariants: assignmentAttempt.questionVariants.map((qv) => ({
        ...qv,
        randomizedChoices:
          typeof qv.randomizedChoices === "string"
            ? qv.randomizedChoices
            : JSON.stringify(qv.randomizedChoices ?? false),
        questionVariant: {
          ...qv.questionVariant,
          answer:
            typeof qv?.questionVariant?.answer === "boolean"
              ? String(qv?.questionVariant?.answer)
              : qv?.questionVariant?.answer,
          variantOf: qv?.questionVariant?.variantOf
            ? {
                ...qv?.questionVariant?.variantOf,
                answer:
                  typeof qv?.questionVariant?.variantOf.answer === "boolean"
                    ? String(qv?.questionVariant?.variantOf.answer)
                    : qv?.questionVariant?.variantOf.answer,
              }
            : undefined,
        },
      })),
    };

    // Every visibility setting is defined relative to submission ("shown after
    // submission", "shown on pass"). While the attempt is open there is nothing
    // to reveal yet, so the setting is only consulted once it is submitted.
    const visibilityForAttempt: CorrectAnswerVisibility =
      assignmentAttempt.submitted
        ? assignment.currentVersion?.correctAnswerVisibility || "NEVER"
        : "NEVER";

    const shouldShowAllQuestions = this.shouldShowCorrectAnswers(
      visibilityForAttempt,
      assignmentAttempt.grade || 0,
      assignment.passingGrade,
    );

    const assignmentForTranslation = {
      ...assignment,
      questionOrder: shouldShowAllQuestions
        ? questionsForTranslation.map((q) => q.id)
        : assignment.questionOrder,
      questions: questionsForTranslation,
    } as unknown as UpdateAssignmentQuestionsDto;

    const mappedQuestions =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        formattedAttempt,
        assignmentForTranslation,
        translations,
        normalizedLanguage,
      );

    // Answer-key fields are revealed only once the attempt is submitted and
    // the visibility setting allows it (`visibilityForAttempt` is NEVER while
    // the attempt is open).
    const revealAnswers = this.shouldShowCorrectAnswers(
      visibilityForAttempt,
      assignmentAttempt.grade || 0,
      assignment.passingGrade,
    );
    const finalQuestions = mappedQuestions.map((question) =>
      toLearnerAttemptQuestion(question, revealAnswers),
    );

    const versionMismatch =
      assignmentAttempt.assignmentVersionId !== null &&
      assignment.currentVersionId !== null &&
      assignmentAttempt.assignmentVersionId !== assignment.currentVersionId;

    this.logger.debug(
      `getAssignmentAttempt: attempt=${attemptId} assignment=${assignmentAttempt.assignmentId} questions=${finalQuestions.length} language=${normalizedLanguage}`,
    );

    // Built key by key: the attempt was loaded with relations (question
    // versions, variants) that carry the answer key and must not be spread.
    // No pass/fail verdict here on purpose. This route serves the in-progress
    // attempt, so it has none of the clamping the completed route applies to
    // historically over-scored responses; deriving `passed` from the raw
    // persisted grade would contradict the verdict the learner is shown on the
    // success page. Pass/fail belongs to the completed and submit responses.
    return {
      id: assignmentAttempt.id,
      assignmentId: assignmentAttempt.assignmentId,
      assignmentVersionId: assignmentAttempt.assignmentVersionId,
      userId: assignmentAttempt.userId,
      submitted: assignmentAttempt.submitted,
      grade:
        assignmentAttempt.submitted && assignment.showAssignmentScore
          ? assignmentAttempt.grade
          : null,
      expiresAt: assignmentAttempt.expiresAt,
      createdAt: assignmentAttempt.createdAt,
      questionOrder: assignmentAttempt.questionOrder,
      comments: assignmentAttempt.comments,
      preferredLanguage: assignmentAttempt.preferredLanguage,
      serverNow: readServerClock(),
      questions: finalQuestions,
      questionResponses: assignmentAttempt.questionResponses.map(
        (response) => ({
          id: response.id,
          assignmentAttemptId: response.assignmentAttemptId,
          questionId: response.questionId,
          learnerResponse: response.learnerResponse,
          points: response.points,
          feedback: response.feedback,
          metadata: response.metadata,
          gradedAt: response.gradedAt,
        }),
      ),
      passingGrade: assignment.passingGrade ?? DEFAULT_PASSING_GRADE,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      showQuestions: assignment.showQuestions,
      correctAnswerVisibility:
        assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      currentVersionId: assignment.currentVersionId,
      versionMismatch,
      assignmentVersion: assignmentAttempt.assignmentVersion
        ? {
            id: assignmentAttempt.assignmentVersion.id,
            allotedTimeMinutes:
              assignmentAttempt.assignmentVersion.allotedTimeMinutes,
          }
        : null,
    };
  }

  /**
   * Updates an attempt for a learner.
   *
   * Uses a 3-phase grading flow:
   *   Phase 1+2 — gradeQuestionsForLearner: load question DTOs (short tx) + LLM grading (no tx)
   *   Grade computation + validation (in-memory)
   *   Phase 3 — commitAttemptWithResponses: write QuestionResponse records and
   *              AssignmentAttempt.grade atomically in a single short transaction
   *   LTI callback (external, strictly after the DB commit)
   */
  private async updateLearnerAttempt(
    attemptId: number,
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
    progressCallback?: (
      progress: string,
      percentage?: number,
      details?: GradingProgressDetails,
    ) => Promise<void>,
    cache?: JobScopedCache,
    submissionReceivedAt?: Date,
  ): Promise<SubmitAssignmentAttemptResponseDto> {
    // Allocate the per-invocation cache once and share it across both
    // pre-translate and grading phases. Without this hoist, callers that
    // omit `cache` (the inline path) cause preTranslateQuestions to issue
    // its own findUnique calls per variant before gradeQuestionsForLearner
    // allocates its own fresh cache and re-issues the same lookups during
    // its Phase-0 hoist. It also carries the attempt's pinned questions to
    // every grading read.
    const effectiveCache: JobScopedCache = cache ?? newJobScopedCache();
    try {
      if (progressCallback) {
        await progressCallback("Validating submission...", 5);
      }

      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: attemptId },
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
          `AssignmentAttempt with Id ${attemptId} not found.`,
        );
      }

      // Short-circuit a duplicate submit before the expensive grading pipeline.
      // commitAttemptWithResponses re-checks this atomically, but that check
      // only fires AFTER grading — so a duplicate job would otherwise re-run the
      // full LLM grade (tens of seconds, real cost) just to be rejected at
      // commit. Bailing here turns the common "submitted twice" case into a
      // sub-second conflict; the worker treats this ConflictException as a
      // successful idempotent no-op.
      if (assignmentAttempt.submitted) {
        this.logger.warn(
          `updateLearnerAttempt: attempt ${attemptId} already submitted; skipping re-grade`,
        );
        throw new AttemptClosedException(
          attemptId,
          wasClosedAtTimeLimit(assignmentAttempt.comments)
            ? "time_limit"
            : "already_submitted",
        );
      }

      // Judged at the moment the API received the submit, not when this
      // (possibly queued) grading run started: queue wait is not the
      // learner's lateness.
      if (
        this.validationService.isAttemptExpired(
          assignmentAttempt.expiresAt,
          submissionReceivedAt,
        )
      ) {
        // A submission that arrives past the deadline carrying nothing the
        // learner typed is the signature of a client-side timer firing on a
        // clock it should not have trusted. Record it so the pattern is
        // visible without changing what happens to the attempt.
        if (countAnsweredResponses(updateDto.responsesForQuestions) === 0) {
          this.logger.warn(
            `updateLearnerAttempt: expired attempt submitted without any answers ` +
              `attempt=${attemptId} assignment=${assignmentId} ` +
              `user=${request.userSession.userId} ` +
              `responses=${updateDto.responsesForQuestions?.length ?? 0}`,
          );
        }
        const expiredResult = await this.handleExpiredAttempt(attemptId);
        return expiredResult;
      }

      const plan = await this.resolveSubmitPlan(
        assignmentAttempt,
        assignmentId,
        request.userSession.userId,
        updateDto,
      );
      const {
        assignment,
        pinnedQuestions,
        responses,
        gradedQuestionIds,
        totalPossiblePoints,
      } = plan;
      if (pinnedQuestions) {
        effectiveCache.pinnedQuestions = pinnedQuestions;
      }

      if (progressCallback) {
        await progressCallback("Pre-translating questions...", 10);
      }

      const preTranslatedQuestions =
        await this.translationService.preTranslateQuestions(
          responses,
          assignmentAttempt,
          updateDto.language,
          effectiveCache,
        );

      updateDto.preTranslatedQuestions = preTranslatedQuestions;

      // ── Phases 1+2: Load question DTOs (short tx) + grade with LLM (no tx) ──
      // Every served, gradable question is graded: one the learner left out
      // of the payload is graded as an empty answer and scores zero.
      const gradedItems: GradedItem[] =
        await this.questionResponseService.gradeQuestionsForLearner(
          responses,
          attemptId,
          assignmentId,
          updateDto.language,
          updateDto.preTranslatedQuestions,
          effectiveCache,
          assignmentAttempt.userId,
          {
            // Judged from the server's receive time and deadline only.
            scoreBlockedAsZero: isFinalSubmitBeforeDeadline(
              assignmentAttempt.expiresAt,
              submissionReceivedAt,
            ),
          },
        );

      const successfulQuestionResponses = gradedItems.map((g) => g.responseDto);

      if (progressCallback) {
        await progressCallback("Calculating final grade...", 92);
      }

      // The denominator is the served, gradable set, whatever the payload
      // carried: leaving a question out can only cost the learner its points.
      // resolveSubmitPlan has already refused a submit with nothing gradable.
      if (totalPossiblePoints <= 0) {
        this.logger.error("submitLearnerAttempt: invalid totalPossiblePoints", {
          attemptId,
          assignmentId,
          totalPossiblePoints,
          response_count: successfulQuestionResponses.length,
          graded_question_count: gradedQuestionIds.length,
        });
        throw new InternalServerErrorException(
          `Invalid totalPossiblePoints (${totalPossiblePoints}) calculated for attemptId ${attemptId}. ` +
            `This indicates a critical grading error. ` +
            `Responses: ${successfulQuestionResponses.length}, ` +
            `Questions: ${gradedQuestionIds.length}`,
        );
      }

      const { grade, totalPointsEarned } =
        this.gradingService.calculateGradeForLearner(
          successfulQuestionResponses,
          totalPossiblePoints,
        );

      if (Number.isNaN(grade) || grade < 0 || grade > 1) {
        this.logger.error("submitLearnerAttempt: invalid grade out of [0,1]", {
          attemptId,
          assignmentId,
          grade,
          totalPointsEarned,
          totalPossiblePoints,
        });
        throw new InternalServerErrorException(
          `Invalid grade calculated: ${grade}. ` +
            `totalPointsEarned: ${totalPointsEarned}, ` +
            `totalPossiblePoints: ${totalPossiblePoints}`,
        );
      }

      if (progressCallback) {
        await progressCallback("Finalizing results...", 95);
      }

      // ── Phase 3: Atomic write (QuestionResponse records + AssignmentAttempt.grade) ──
      const result =
        await this.questionResponseService.commitAttemptWithResponses(
          attemptId,
          gradedItems,
          grade,
          updateDto,
        );

      // LTI delivery strictly AFTER the commit: a grade must never reach the
      // LMS for a submission that did not durably persist — a failed commit
      // throws above and the callback never sees the grade. The reverse risk
      // does not exist: sendGradeToLtiGateway never throws (sync failures go
      // to its own retry queue), so a delivery hiccup cannot fail an
      // already-committed attempt.
      if (gradingCallbackRequired) {
        if (progressCallback) {
          await progressCallback("Sending grade to LTI...", 98);
        }
        await this.handleLtiGradeCallback(
          attemptId,
          grade,
          authCookie,
          assignmentId,
          request.userSession.userId,
        );
      }

      // Only now is the grade readable, so only now may the progress row say
      // COMPLETED. Everything above — grade computation, the commit
      // transaction itself — used to run after the row had already been
      // flipped, which let a client see "done" and then read an unsubmitted,
      // ungraded attempt.
      await this.questionResponseService.markGradingComplete(attemptId);

      await this.pruneAutoSavedResponses(
        attemptId,
        successfulQuestionResponses,
      );

      if (progressCallback) {
        await progressCallback("Grading completed!", 100);
      }

      return buildSubmitResult({
        attemptId: result.id,
        grade: result.grade,
        totalPointsEarned,
        totalPossiblePoints,
        settings: {
          showAssignmentScore: assignment.showAssignmentScore,
          showSubmissionFeedback: assignment.showSubmissionFeedback,
          showQuestions: assignment.showQuestions,
          showQuestionScore: assignment.showQuestionScore,
          showPassFailIndicator: assignment.showPassFailIndicator,
          passingGrade: assignment.passingGrade,
          correctAnswerVisibility:
            assignment.currentVersion?.correctAnswerVisibility,
        },
        responses: successfulQuestionResponses,
        language: updateDto.language,
      });
    } catch (error) {
      if (progressCallback) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await progressCallback(`Error: ${errorMessage}`, 0);
      }
      throw error;
    }
  }

  /**
   * Check a learner submit against the attempt before anything is queued or
   * graded, so a payload the grader would refuse gets its 400/422 on the
   * PATCH itself. Grading repeats the same checks.
   */
  async assertSubmitPayloadAcceptable(
    attemptId: number,
    assignmentId: number,
    userId: string,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
  ): Promise<void> {
    const attempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, questionOrder: true, assignmentVersionId: true },
    });
    if (!attempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }
    await this.resolveSubmitPlan(attempt, assignmentId, userId, updateDto);
  }

  /**
   * What the learner UI needs to decide whether an attempt is still editable,
   * with a server clock reading taken now, not one replayed from a cached
   * attempt payload. Scoped to the route assignment and the learner's own
   * attempts; anything else is the same 404.
   */
  async getAttemptSubmissionStatus(
    attemptId: number,
    assignmentId: number,
    userId: string,
  ): Promise<AttemptSubmissionStatusDto> {
    const attempt = userId
      ? await this.prisma.assignmentAttempt.findFirst({
          where: { id: attemptId, assignmentId, userId },
          select: {
            id: true,
            submitted: true,
            comments: true,
            expiresAt: true,
          },
        })
      : null;

    if (!attempt) {
      this.logger.warn(
        `getAttemptSubmissionStatus: refused attempt_id=${attemptId} assignment_id=${assignmentId} user_id=${userId} denial_reason=not_found_or_unowned`,
      );
      throw new NotFoundException("Attempt not found or not owned by the user");
    }

    const serverNow = readServerClock();
    const pastDeadline = this.validationService.isAttemptExpired(
      attempt.expiresAt,
      new Date(serverNow),
    );

    return {
      id: attempt.id,
      submitted: attempt.submitted,
      closedAtTimeLimit:
        attempt.submitted && wasClosedAtTimeLimit(attempt.comments),
      acceptingSubmissions: !attempt.submitted && !pastDeadline,
      expiresAt: attempt.expiresAt
        ? new Date(attempt.expiresAt).toISOString()
        : null,
      serverNow,
    };
  }

  /**
   * Work out what a learner submit grades, and refuse what it must not.
   *
   * Questions come from the attempt's pinned assignment version when it has
   * one, else the live rows. The served set is the attempt's question order,
   * else the assignment's, else every question in that source. Response
   * types that are no longer graded (MEDIA_RESPONSE_TYPES) are left out of
   * grading, the denominator and the required-answer check. Every other
   * served question is graded, with an empty answer standing in for one the
   * payload left out.
   *
   * Refusals: a submitted id that is not served, or appears twice (400); an
   * answer to a media question (400 UNSUPPORTED_RESPONSE_TYPE); a file that
   * is not the learner's own upload for that question (400); an unanswered
   * required question (422).
   */
  private async resolveSubmitPlan(
    attempt: Pick<
      AssignmentAttempt,
      "id" | "questionOrder" | "assignmentVersionId"
    >,
    assignmentId: number,
    userId: string,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
  ): Promise<SubmitPlan> {
    const attemptId = attempt.id;
    const refuse = (denialReason: string, extra?: Record<string, unknown>) =>
      this.logger.warn("submit.rejected", {
        assignment_id: assignmentId,
        attempt_id: attemptId,
        user_id: userId,
        denial_reason: denialReason,
        ...extra,
      });

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        questions: {
          where: { isDeleted: false },
        },
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }

    let pinnedQuestions: Map<number, QuestionDto> | null = null;
    if (attempt.assignmentVersionId) {
      const questionVersions = await this.prisma.questionVersion.findMany({
        where: { assignmentVersionId: attempt.assignmentVersionId },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      });
      if (questionVersions.length > 0) {
        pinnedQuestions = pinnedQuestionMap(questionVersions, assignmentId);
      } else {
        this.logger.warn("submit.pinned_version_empty", {
          assignment_id: assignmentId,
          attempt_id: attemptId,
          assignment_version_id: attempt.assignmentVersionId,
        });
      }
    }

    const questionMeta = new Map<
      number,
      { totalPoints: number; responseType: string | null | undefined }
    >();
    if (pinnedQuestions) {
      for (const question of pinnedQuestions.values()) {
        questionMeta.set(question.id, {
          totalPoints: question.totalPoints,
          responseType: question.responseType,
        });
      }
    } else {
      for (const question of assignment.questions) {
        questionMeta.set(question.id, {
          totalPoints: question.totalPoints,
          responseType: question.responseType,
        });
      }
    }

    const servedQuestionIds = attempt.questionOrder?.length
      ? attempt.questionOrder
      : assignment.questionOrder?.length
        ? assignment.questionOrder
        : [...questionMeta.keys()];
    const servedQuestionIdSet = new Set(servedQuestionIds);

    const submittedQuestionIds = updateDto.responsesForQuestions.map(
      (response) => response.id,
    );
    const invalidQuestionIds = [
      ...new Set(
        submittedQuestionIds.filter(
          (questionId) => !servedQuestionIdSet.has(questionId),
        ),
      ),
    ];
    const duplicateQuestionIds = [
      ...new Set(
        submittedQuestionIds.filter(
          (questionId, index) =>
            submittedQuestionIds.indexOf(questionId) !== index,
        ),
      ),
    ];
    if (invalidQuestionIds.length > 0 || duplicateQuestionIds.length > 0) {
      refuse("unserved_or_duplicate_question_ids", {
        unserved_count: invalidQuestionIds.length,
        duplicate_count: duplicateQuestionIds.length,
      });
      throw new BadRequestException(
        `Invalid question responses for attempt ${attemptId}: ` +
          [
            invalidQuestionIds.length > 0
              ? `unserved question IDs [${invalidQuestionIds.join(", ")}]`
              : null,
            duplicateQuestionIds.length > 0
              ? `duplicate question IDs [${duplicateQuestionIds.join(", ")}]`
              : null,
          ]
            .filter((message): message is string => message !== null)
            .join("; "),
      );
    }

    // A served question missing from the source (deleted since an unpinned
    // attempt began, or absent from its version) still counts; its row is
    // read even when soft-deleted.
    const unresolvedIds = servedQuestionIds.filter(
      (questionId) => !questionMeta.has(questionId),
    );
    if (unresolvedIds.length > 0) {
      const rows = await this.prisma.question.findMany({
        where: { id: { in: unresolvedIds }, assignmentId },
        select: { id: true, totalPoints: true, responseType: true },
      });
      for (const row of rows) {
        questionMeta.set(row.id, {
          totalPoints: row.totalPoints,
          responseType: row.responseType,
        });
      }
      const stillMissing = unresolvedIds.filter((id) => !questionMeta.has(id));
      if (stillMissing.length > 0) {
        this.logger.error("submit.served_question_unresolved", {
          assignment_id: assignmentId,
          attempt_id: attemptId,
          question_ids: stillMissing,
        });
        throw new InternalServerErrorException(
          `Cannot calculate totalPossiblePoints: Question ${stillMissing[0]} not found ` +
            `in database. This prevents accurate grading.`,
        );
      }
    }

    const mediaQuestionIds = new Set(
      servedQuestionIds.filter((questionId) =>
        isMediaResponseType(questionMeta.get(questionId)?.responseType),
      ),
    );
    const responseById = new Map(
      updateDto.responsesForQuestions.map((response) => [
        response.id,
        response,
      ]),
    );

    const answeredMediaIds = [...mediaQuestionIds].filter((questionId) =>
      this.hasLearnerResponse(responseById.get(questionId)),
    );
    if (answeredMediaIds.length > 0) {
      refuse("unsupported_response_type", {
        question_ids: answeredMediaIds,
      });
      throw new UnsupportedResponseTypeException();
    }

    const allowedBuckets = S3Service.learnerUploadBuckets();
    for (const response of updateDto.responsesForQuestions) {
      const files = response.learnerFileResponse;
      if (!Array.isArray(files) || files.length === 0) {
        continue;
      }
      const denial = findLearnerFileReferenceDenial(files, {
        assignmentId,
        userId,
        questionId: response.id,
        allowedBuckets,
      });
      if (denial) {
        refuse(denial, { question_id: response.id });
        throw new InvalidLearnerFileReferenceException();
      }
    }

    const gradedQuestionIds = servedQuestionIds.filter(
      (questionId) => !mediaQuestionIds.has(questionId),
    );
    if (gradedQuestionIds.length === 0) {
      refuse("no_gradable_questions", {
        served_question_count: servedQuestionIds.length,
        media_question_count: mediaQuestionIds.size,
      });
      throw new NoGradableQuestionsException();
    }

    if (assignment.requireAllQuestions) {
      const optionalQuestionIdsValue: unknown = assignment.optionalQuestionIds;
      const optionalQuestionIds = new Set<number>(
        Array.isArray(optionalQuestionIdsValue)
          ? optionalQuestionIdsValue.filter(
              (questionId): questionId is number =>
                typeof questionId === "number" && !Number.isNaN(questionId),
            )
          : [],
      );
      const unansweredCount = gradedQuestionIds.filter(
        (questionId) =>
          !optionalQuestionIds.has(questionId) &&
          !this.hasLearnerResponse(responseById.get(questionId)),
      ).length;

      if (unansweredCount > 0) {
        refuse("required_questions_unanswered", {
          unanswered_count: unansweredCount,
        });
        throw new UnprocessableEntityException(
          `All required questions must be answered before submitting (${unansweredCount} unanswered).`,
        );
      }
    }

    const responses = gradedQuestionIds.map(
      (questionId): SubmittedQuestionResponseDto =>
        responseById.get(questionId) ?? {
          id: questionId,
          learnerTextResponse: "",
          learnerUrlResponse: "",
          learnerChoices: [],
          learnerAnswerChoice: null,
          learnerFileResponse: [],
          learnerPresentationResponse: null,
          language: updateDto.language,
        },
    );

    const totalPossiblePoints = gradedQuestionIds.reduce(
      (sum, questionId) =>
        sum + (questionMeta.get(questionId)?.totalPoints ?? 0),
      0,
    );

    return {
      assignment,
      pinnedQuestions,
      servedQuestionIds,
      gradedQuestionIds,
      responses,
      totalPossiblePoints,
    };
  }

  /**
   * Updates an attempt for an author (preview mode)
   */
  private async updateAuthorAttempt(
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    authorUserId: string,
    progressCallback?: (
      progress: string,
      percentage?: number,
      details?: GradingProgressDetails,
    ) => Promise<void>,
  ): Promise<SubmitAssignmentAttemptResponseDto> {
    try {
      if (progressCallback) {
        await progressCallback("Setting up preview...", 5);
      }

      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          questions: {
            where: { isDeleted: false },
          },
          currentVersion: {
            select: {
              correctAnswerVisibility: true,
            },
          },
        },
      });

      const fakeAttemptId = -1;

      if (progressCallback) {
        await progressCallback("Grading questions...", 10);
      }

      const successfulQuestionResponses =
        await this.questionResponseService.submitQuestions(
          updateDto.responsesForQuestions,
          fakeAttemptId,
          UserRole.AUTHOR,
          assignmentId,
          updateDto.language,
          updateDto.authorQuestions,
          updateDto.authorAssignmentDetails,
          undefined,
          authorUserId,
        );

      if (progressCallback) {
        await progressCallback("Calculating results...", 92);
      }

      const { totalPossiblePoints, missingQuestions } =
        await this.calculateTotalPossiblePointsWithValidation(
          successfulQuestionResponses,
          updateDto.authorQuestions ?? assignment.questions,
          { allowDatabaseFallback: false },
        );

      if (totalPossiblePoints <= 0) {
        this.logger.error("authorPreview: invalid totalPossiblePoints", {
          assignmentId,
          totalPossiblePoints,
          response_count: successfulQuestionResponses.length,
        });
        throw new InternalServerErrorException(
          `Invalid totalPossiblePoints (${totalPossiblePoints}) in author preview for assignmentId ${assignmentId}.`,
        );
      }

      const { grade, totalPointsEarned } =
        this.gradingService.calculateGradeForAuthor(
          successfulQuestionResponses,
          totalPossiblePoints,
        );

      if (Number.isNaN(grade) || grade < 0 || grade > 1) {
        this.logger.error("authorPreview: invalid grade out of [0,1]", {
          assignmentId,
          grade,
          totalPointsEarned,
          totalPossiblePoints,
        });
        throw new InternalServerErrorException(
          `Invalid grade calculated in author preview: ${grade}. ` +
            `totalPointsEarned: ${totalPointsEarned}, ` +
            `totalPossiblePoints: ${totalPossiblePoints}`,
        );
      }

      if (progressCallback) {
        await progressCallback("Preview completed!", 100);
      }

      // The author's unsaved pass/fail settings ride in on the preview
      // request; prefer them over the persisted row so previewing before
      // publish reflects the toggle. This path is author-only and the values
      // shape nothing but the author's own unpersisted preview response.
      const showPassFailIndicator =
        updateDto.authorAssignmentDetails?.showPassFailIndicator ??
        assignment.showPassFailIndicator;
      const passingGrade =
        updateDto.authorAssignmentDetails?.passingGrade ??
        assignment.passingGrade;

      // The preview mirrors the learner submit result, hidden values
      // included: it is often the author's only way to see what learners
      // actually get.
      return buildSubmitResult({
        attemptId: -1,
        grade,
        totalPointsEarned,
        totalPossiblePoints,
        settings: {
          showAssignmentScore: assignment.showAssignmentScore,
          showSubmissionFeedback: assignment.showSubmissionFeedback,
          showQuestions: assignment.showQuestions,
          showQuestionScore: assignment.showQuestionScore,
          showPassFailIndicator,
          passingGrade,
          correctAnswerVisibility:
            assignment.currentVersion?.correctAnswerVisibility,
        },
        responses: successfulQuestionResponses,
        language: updateDto.language,
      });
    } catch (error) {
      if (progressCallback) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        await progressCallback(`Error: ${errorMessage}`, 0);
      }
      throw error;
    }
  }

  /**
   * Gate a learner submit before anything is queued or graded.
   *
   * The deadline is judged at `receivedAt`, the moment the API received the
   * PATCH. A submit on an attempt that is already closed, or one that arrived
   * after the grace window, gets a synchronous 409 that says which of the two
   * it was. The late case also closes the attempt at zero first: there is no
   * server-side record of what the learner had answered before the deadline
   * (answers live in the browser until submit), so nothing in this request can
   * be shown to predate `expiresAt`, and grading it would grade work written
   * after time was up.
   *
   * The exception is a submit that was already accepted: while its grading
   * job is in flight the attempt still reads `submitted: false`. A retry or a
   * second tab arriving after the window must not close it at zero, which
   * would discard the on-time work when the job tries to commit. With
   * `inFlightGradingJobId` set, a late submit is let through so the caller
   * can hand back that job instead.
   */
  async assertLearnerAttemptOpenForSubmit(
    attemptId: number,
    receivedAt: Date,
    inFlightGradingJobId?: string,
  ): Promise<void> {
    const attempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      select: { id: true, submitted: true, comments: true, expiresAt: true },
    });

    if (!attempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
    }

    if (attempt.submitted) {
      const reason = wasClosedAtTimeLimit(attempt.comments)
        ? "time_limit"
        : "already_submitted";
      this.logger.warn(
        `submit.rejected.closed attempt=${attemptId} reason=${reason}`,
      );
      throw new AttemptClosedException(attemptId, reason);
    }

    if (
      this.validationService.isAttemptExpired(attempt.expiresAt, receivedAt)
    ) {
      const lateByMs =
        receivedAt.getTime() - new Date(attempt.expiresAt).getTime();
      if (inFlightGradingJobId) {
        this.logger.warn(
          `submit.past_deadline.in_flight attempt=${attemptId} lateByMs=${lateByMs} gradingJobId=${inFlightGradingJobId}`,
        );
        return;
      }
      this.logger.warn(
        `submit.rejected.past_deadline attempt=${attemptId} lateByMs=${lateByMs}`,
      );
      await this.closeExpiredAttempt(attemptId);
      throw new AttemptClosedException(attemptId, "time_limit");
    }
  }

  /**
   * Close an attempt at zero because its submit came in past the deadline.
   * Conditional on the attempt still being open, so it can never overwrite a
   * grade a concurrent on-time submit has just committed.
   */
  private async closeExpiredAttempt(attemptId: number): Promise<void> {
    const { count } = await this.prisma.assignmentAttempt.updateMany({
      where: { id: attemptId, submitted: false },
      data: {
        submitted: true,
        grade: 0,
        comments: EXPIRED_ATTEMPT_COMMENT,
      },
    });

    if (count === 0) {
      this.logger.warn(
        `closeExpiredAttempt: attempt ${attemptId} was already submitted; leaving it as is`,
      );
      throw new AttemptClosedException(attemptId, "already_submitted");
    }
  }

  /**
   * Handle an expired attempt
   */
  private async handleExpiredAttempt(
    attemptId: number,
  ): Promise<SubmitAssignmentAttemptResponseDto> {
    await this.closeExpiredAttempt(attemptId);

    return closedAtTimeLimitResult(attemptId);
  }

  /**
   * Handle the LTI grade callback
   */
  private async handleLtiGradeCallback(
    attemptId: number,
    grade: number,
    authCookie: string,
    assignmentId: number,
    userId: string,
  ): Promise<void> {
    const userAttempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId,
        assignmentId,
      },
      select: {
        grade: true,
      },
    });

    let highestOverall = 0;
    for (const attempt of userAttempts) {
      if (attempt.grade && attempt.grade > highestOverall) {
        highestOverall = attempt.grade;
      }
    }

    if (grade && grade > highestOverall) {
      highestOverall = grade;
    }

    await this.sendGradeToLtiGateway(
      attemptId,
      highestOverall,
      authCookie,
      assignmentId,
      userId,
    );
  }
  private hasPresentationResponse(
    response?: {
      transcript?: string | null;
      slidesData?: unknown[] | null;
    } | null,
  ): boolean {
    if (!response) {
      return false;
    }
    const transcript = response.transcript?.trim() ?? "";
    if (transcript.length > 0) {
      return true;
    }
    return (response.slidesData?.length ?? 0) > 0;
  }

  private hasLearnerResponse(
    response?: LearnerUpdateAssignmentAttemptRequestDto["responsesForQuestions"][number],
  ): boolean {
    if (!response) {
      return false;
    }
    const hasText = hasTextContent(response.learnerTextResponse);
    const hasUrl = Boolean(response.learnerUrlResponse?.trim());
    const hasChoices = (response.learnerChoices?.length ?? 0) > 0;
    const hasAnswerChoice =
      response.learnerAnswerChoice !== null &&
      response.learnerAnswerChoice !== undefined;
    const hasFiles = (response.learnerFileResponse?.length ?? 0) > 0;
    const hasPresentation = this.hasPresentationResponse(
      response.learnerPresentationResponse,
    );

    return (
      hasText ||
      hasUrl ||
      hasChoices ||
      hasAnswerChoice ||
      hasFiles ||
      hasPresentation
    );
  }
  private async pruneAutoSavedResponses(
    attemptId: number,
    responses: CreateQuestionResponseAttemptResponseDto[],
  ): Promise<void> {
    const responseIds = [
      ...new Set(
        responses
          .map((response) => response.id)
          .filter((id): id is number => typeof id === "number"),
      ),
    ];

    if (responseIds.length === 0) {
      return;
    }

    try {
      await this.prisma.questionResponse.deleteMany({
        where: {
          assignmentAttemptId: attemptId,
          id: { notIn: responseIds },
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      // Best-effort post-commit cleanup: the submission has already committed,
      // so we surface the failure in logs rather than failing the request.
      this.logger.error(
        "pruneAutoSavedResponses: failed to delete stale auto-saved responses",
        {
          attemptId,
          response_count: responseIds.length,
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
    }
  }

  /**
   * Send a grade to the LTI gateway using the retry service.
   * This method delegates to LtiGradeSyncService which handles retries, logging, and notifications.
   * It does NOT throw exceptions - failures are handled gracefully with scheduled retries.
   */
  private async sendGradeToLtiGateway(
    attemptId: number,
    grade: number,
    authCookie: string,
    assignmentId: number,
    userId: string,
  ): Promise<void> {
    this.logger.log(
      `Initiating LTI grade sync for attempt ${attemptId}, grade: ${grade}`,
    );

    try {
      const syncResult = await this.ltiGradeSyncService.createAndSync({
        attemptId,
        userId,
        assignmentId,
        grade,
        authCookie,
      });

      if (syncResult.success) {
        this.logger.log(
          `✅ Successfully synced grade ${grade} for attempt ${attemptId}`,
        );
      } else {
        // Sync failed but retry is scheduled - log it but don't throw
        this.logger.warn(
          `⏰ LTI grade sync failed for attempt ${attemptId}, but retry is scheduled. ` +
            `Status: ${syncResult.status}, Message: ${syncResult.message}`,
        );
      }
    } catch (error) {
      // Even if the sync service throws (unlikely), we should NOT crash the grading job
      // Log the error and continue - the sync service will handle retries
      this.logger.error(
        `Unexpected error while initiating LTI grade sync for attempt ${attemptId}`,
        error instanceof Error ? error.stack : String(error),
      );

      // DO NOT throw - we don't want to fail the grading job
      // The grade is saved in the database, LTI sync can be retried later
    }
  }

  /**
   * Calculates total possible points with validation to prevent grade miscalculation bugs.
   *
   * to prevent bugs where questions are deleted/filtered after attempt creation.
   *
   * @param responses - The graded question responses
   * @param assignmentQuestions - Questions from the active grading source
   * @param options - Controls whether missing questions should be looked up in the database
   * @returns Object containing totalPossiblePoints and array of missing question IDs
   */
  private async calculateTotalPossiblePointsWithValidation(
    responses: CreateQuestionResponseAttemptResponseDto[],
    assignmentQuestions: QuestionPointsSource[],
    options?: {
      allowDatabaseFallback?: boolean;
    },
  ): Promise<{
    totalPossiblePoints: number;
    missingQuestions: number[];
  }> {
    const allowDatabaseFallback = options?.allowDatabaseFallback ?? true;
    let totalPossiblePoints = 0;
    const missingQuestions: number[] = [];
    const questionMap = new Map(
      assignmentQuestions.map((q) => [q.id, q.totalPoints]),
    );

    const missingQuestionIds: number[] = [];

    for (const response of responses) {
      const questionTotalPoints = questionMap.get(response.questionId);

      if (questionTotalPoints === undefined) {
        const responseMetadata = response.metadata as {
          maxPossiblePoints?: number;
        } | null;

        if (
          responseMetadata &&
          typeof responseMetadata.maxPossiblePoints === "number" &&
          responseMetadata.maxPossiblePoints > 0
        ) {
          totalPossiblePoints += responseMetadata.maxPossiblePoints;
          missingQuestions.push(response.questionId);
        } else {
          missingQuestionIds.push(response.questionId);
        }
      } else {
        totalPossiblePoints += questionTotalPoints;
      }
    }

    if (missingQuestionIds.length > 0) {
      if (!allowDatabaseFallback) {
        this.logger.error(
          "calculateTotalPossiblePoints: missing questions in author preview (no DB fallback)",
          {
            missing_question_ids: missingQuestionIds,
            total_so_far: totalPossiblePoints,
          },
        );
        throw new InternalServerErrorException(
          `Cannot calculate totalPossiblePoints: Question ${missingQuestionIds[0]} not found ` +
            `in provided questions. This prevents accurate grading.`,
        );
      }

      try {
        const deletedQuestions = await this.prisma.question.findMany({
          where: {
            id: { in: missingQuestionIds },
          },
          select: {
            id: true,
            totalPoints: true,
          },
        });

        const deletedQuestionsMap = new Map(
          deletedQuestions.map((q) => [q.id, q.totalPoints]),
        );

        for (const questionId of missingQuestionIds) {
          const points = deletedQuestionsMap.get(questionId);

          if (points !== undefined && points > 0) {
            totalPossiblePoints += points;
            missingQuestions.push(questionId);
          } else {
            this.logger.error(
              "calculateTotalPossiblePoints: question not in DB either",
              {
                question_id: questionId,
                missing_question_ids: missingQuestionIds,
                points_seen: points,
              },
            );
            throw new InternalServerErrorException(
              `Cannot calculate totalPossiblePoints: Question ${questionId} not found ` +
                `in database. This prevents accurate grading.`,
            );
          }
        }
      } catch (error) {
        if (error instanceof InternalServerErrorException) {
          throw error;
        }
        this.logger.error(
          "calculateTotalPossiblePoints: Prisma query for deleted questions failed",
          {
            missing_question_ids: missingQuestionIds,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          },
        );
        throw new InternalServerErrorException(
          `Failed to query deleted questions for grade calculation: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { totalPossiblePoints, missingQuestions };
  }

  /**
   * Calculate the expiration date for an attempt
   */
  private calculateAttemptExpiresAt(
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
  ): Date | null {
    if (
      assignment.allotedTimeMinutes !== undefined &&
      assignment.allotedTimeMinutes > 0
    ) {
      return new Date(Date.now() + assignment.allotedTimeMinutes * 60 * 1000);
    }
    return null;
  }

  /**
   * Get ordered questions based on assignment settings
   */
  private getOrderedQuestions(
    questions: QuestionDto[],
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
    shuffleSeed?: number,
  ): QuestionDto[] {
    let orderedQuestions = [...questions];

    if (assignment.displayOrder === "RANDOM") {
      orderedQuestions = this.deterministicShuffle(
        orderedQuestions,
        shuffleSeed ?? Date.now(),
      );
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      orderedQuestions = applyQuestionOrder(
        orderedQuestions,
        assignment.questionOrder,
      );
    }

    return orderedQuestions.map((q) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      assignmentId: q.assignmentId,
      totalPoints: q.totalPoints,
      maxWords: q.maxWords || undefined,
      maxCharacters: q.maxCharacters || undefined,
      choices: this.parseJsonValue<Choice[]>(q.choices, []),
      scoring: this.parseJsonValue<ScoringDto>(q.scoring, {
        type: ScoringType.CRITERIA_BASED,
        showRubricsToLearner: false,
        rubrics: [],
      }),
      answer: (() => {
        if (typeof q.answer === "boolean") {
          return q.answer;
        }
        if (q.answer === "true") {
          return true;
        }
        if (q.answer === "false") {
          return false;
        }
        return;
      })(),
      variants: q.variants,
      gradingContextQuestionIds: q.gradingContextQuestionIds || [],
      responseType: q.responseType || undefined,
      isDeleted: q.isDeleted,
      randomizedChoices:
        typeof q.randomizedChoices === "boolean"
          ? q.randomizedChoices
          : typeof q.randomizedChoices === "string"
            ? q.randomizedChoices === "true"
            : false,
      videoPresentationConfig:
        this.parseJsonValue<VideoPresentationConfig | null>(
          q.videoPresentationConfig,
          null,
        ),
      liveRecordingConfig: this.parseJsonValue<Record<string, unknown> | null>(
        q.liveRecordingConfig,
        null,
      ),
    }));
  }

  /**
   * Deterministically shuffle a list using a simple LCG so grading order is stable per attempt
   */
  private deterministicShuffle<T>(items: T[], seed = 1): T[] {
    const result = [...items];
    let currentSeed = seed || 1;

    for (let index = result.length - 1; index > 0; index--) {
      currentSeed = (currentSeed * 9301 + 49_297) % 233_280;
      const rand = currentSeed / 233_280;
      const swapIndex = Math.floor(rand * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }

    return result;
  }

  private toQuestionDtosForTranslation(
    questions: EnhancedAttemptQuestionDto[],
  ): QuestionDto[] {
    return questions.map((question) => ({
      id: question.id,
      question: question.question,
      type: question.type as QuestionType,
      assignmentId: question.assignmentId,
      totalPoints: question.totalPoints,
      maxWords: question.maxWords,
      maxCharacters: question.maxCharacters,
      choices: question.choices,
      scoring: question.scoring as ScoringDto,
      answer:
        question.answer === "true"
          ? true
          : question.answer === "false"
            ? false
            : undefined,
      variants: [],
      gradingContextQuestionIds: question.gradingContextQuestionIds,
      responseType: question.responseType as ResponseType | undefined,
      isDeleted: question.isDeleted,
      randomizedChoices:
        typeof question.randomizedChoices === "string"
          ? question.randomizedChoices === "true"
          : false,
      videoPresentationConfig:
        (question.videoPresentationConfig as VideoPresentationConfig | null) ??
        undefined,
      liveRecordingConfig: question.liveRecordingConfig ?? undefined,
    }));
  }

  /**
   * Safely parses a JSON value from various formats
   * @param value The value to parse (string, object, or null)
   * @param defaultValue Default value to return if parsing fails
   * @returns Parsed value as specified type T or the default value
   */
  private parseJsonValue<T>(value: unknown, defaultValue: T): T {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return defaultValue;
      }
    }

    return value as T;
  }
  /**
   * Normalize the language code a client asked for.
   *
   * The region is kept. Stored translations are keyed by the code the
   * translation catalogue uses, and three of those codes carry a region
   * (`uk-UA`, `zh-CN`, `zh-TW`); cutting at the hyphen made every one of them
   * unmatchable, so Ukrainian and both Chinese variants were served the
   * authored English even when their translation existed. Widening the code to
   * its family is the job of whatever selects rows to read, not of the code
   * used to pick one.
   */
  private getNormalizedLanguage(language?: string): string {
    return language?.trim().toLowerCase() || "en";
  }

  /**
   * Whether a submitted attempt may see the answer key: ALWAYS yes, NEVER no,
   * ON_PASS only when the grade meets the passing grade. Callers pass NEVER
   * for an attempt that is still open.
   */
  private shouldShowCorrectAnswers(
    correctAnswerVisibility: CorrectAnswerVisibility,
    grade: number | null,
    passingGrade: number | null,
  ): boolean {
    switch (correctAnswerVisibility) {
      case "NEVER": {
        return false;
      }
      case "ALWAYS": {
        return true;
      }
      case "ON_PASS": {
        return meetsPassingGrade(grade, passingGrade);
      }
      default: {
        return false;
      }
    }
  }
}
