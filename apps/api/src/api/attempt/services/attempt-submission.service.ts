/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/no-null */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
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
import { LearnerUpdateAssignmentAttemptRequestDto } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentAttemptQuestions,
  GetAssignmentAttemptResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
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
import { LearnerFacingGradingError } from "../../llm/features/grading/errors/learner-facing-grading.error";
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "../common/utils/attempt-questions-mapper.util";
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

  async autoSaveQuestionResponse(
    attemptId: number,
    assignmentId: number,
    questionId: number,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    userSession: UserSession,
    language: string,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let responseDto: CreateQuestionResponseAttemptResponseDto;
    try {
      responseDto = await this.questionResponseService.createQuestionResponse(
        attemptId,
        { ...requestDto, id: questionId },
        userSession.role,
        assignmentId,
        language,
        undefined,
        undefined,
        undefined,
        undefined,
        userSession.userId,
      );
    } catch (error) {
      // The grading layers deliberately let these typed terminal errors pass
      // through un-wrapped so the job worker can classify them as
      // non-retryable. This autosave route is the one HTTP entry that reaches
      // the same code; translate it here so the learner sees a clear 400 with
      // the learner-facing reason instead of a generic 500 from the global
      // filter.
      if (error instanceof LearnerFacingGradingError) {
        throw new BadRequestException(error.learnerMessage);
      }
      throw error;
    }

    await this.prisma.questionResponse.deleteMany({
      where: {
        assignmentAttemptId: attemptId,
        questionId,
        id: { not: responseDto.id },
      },
    });

    return this.sanitizeAutoSaveResponse(responseDto, userSession.role);
  }

  private sanitizeAutoSaveResponse(
    responseDto: CreateQuestionResponseAttemptResponseDto,
    role: UserRole,
  ): CreateQuestionResponseAttemptResponseDto {
    if (role !== UserRole.LEARNER) {
      return responseDto;
    }

    return {
      id: responseDto.id,
      questionId: responseDto.questionId,
      question: "",
    };
  }
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
      };
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
        currentVersion: {
          include: {
            questionVersions: true,
          },
        },
        questions: {
          where: { isDeleted: false },
          include: {
            variants: {
              where: { isDeleted: false },
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
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const { role } = request.userSession;
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
      );
    } else if (role === UserRole.AUTHOR) {
      return this.updateAuthorAttempt(
        assignmentId,
        updateDto,
        progressCallback,
      );
    } else {
      throw new NotFoundException(
        `User with role ${role} cannot update assignment attempts.`,
      );
    }
  }
  /**
   * Gets a learner assignment attempt with all details needed for display
   */
  async getLearnerAssignmentAttempt(
    attemptId: number,
    userSession: UserSession,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
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
      throw new NotFoundException(
        `AssignmentAttempt with Id ${attemptId} not found.`,
      );
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
    const servedResponses = [...servedResponseByQuestionId.values()];
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
    // Compute score totals before applyVisibilitySettings so they survive
    // even when showQuestions=false strips the questions array. Without this
    // the success page shows "0 / 0" because it can't sum the (empty) array.
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
            select: { id: true, totalPoints: true },
          })
        : [];
    const deletedQuestionMaxById = new Map(
      missingMaxQuestions.map((question) => [
        question.id,
        question.totalPoints,
      ]),
    );
    let totalPossiblePoints = 0;
    for (const questionId of servedQuestionIdSet) {
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
    const effectiveGrade =
      totalPointsEarned < rawPointsEarned && totalPossiblePoints > 0
        ? totalPointsEarned / totalPossiblePoints
        : assignmentAttempt.grade;

    const shouldShowCorrectAnswers = this.shouldShowCorrectAnswers(
      assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      effectiveGrade || 0,
      assignment.passingGrade,
    );

    const questionsToShow = this.applyAnswerVisibilityToQuestionDtos(
      cachedQuestions,
      shouldShowCorrectAnswers,
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

    const finalQuestions =
      await AttemptQuestionsMapper.buildQuestionsWithResponses(
        formattedAttempt,
        questionsToShow,
        {
          id: assignmentAttempt.assignmentId,
          ...assignment,
          questionOrder: questionsToShow.map((q) => q.id),
        },
        this.prisma,
        assignmentAttempt.preferredLanguage || undefined,
      );

    this.applyVisibilitySettings(finalQuestions, assignmentAttempt, assignment);

    // When clamping reduced the total, recompute the grade the learner sees.
    // Read assignmentAttempt.grade after applyVisibilitySettings: that call
    // sets it to null when showAssignmentScore=false, which must be respected
    // even when clamping occurred. The persisted grade and the LTI passback
    // are intentionally left untouched — correcting those is a separate
    // re-grade, not a display fix.
    const displayGrade =
      totalPointsEarned < rawPointsEarned &&
      totalPossiblePoints > 0 &&
      assignmentAttempt.grade !== null
        ? totalPointsEarned / totalPossiblePoints
        : assignmentAttempt.grade;

    return {
      ...assignmentAttempt,
      grade: displayGrade,
      questions: finalQuestions,
      totalPossiblePoints,
      totalPointsEarned:
        assignment.showAssignmentScore === false
          ? undefined
          : totalPointsEarned,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestions: assignment.showQuestions,
      showQuestionScore: assignment.showQuestionScore,
      correctAnswerVisibility:
        assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      comments: assignmentAttempt.comments,
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
  ): Promise<GetAssignmentAttemptResponseDto> {
    const normalizedLanguage = this.getNormalizedLanguage(language);

    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
      include: {
        questionResponses: true,
        questionVariants: {
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
            questionVersions: true,
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
    };

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

    const shouldShowAllQuestions = this.shouldShowCorrectAnswers(
      assignment.currentVersion?.correctAnswerVisibility || "NEVER",
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

    const finalQuestions: AttemptQuestionDto[] =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        formattedAttempt,
        assignmentForTranslation,
        translations,
        normalizedLanguage,
      );

    this.removeSensitiveData(
      finalQuestions,
      {
        correctAnswerVisibility:
          assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      },
      assignmentAttempt.grade || 0,
      assignment.passingGrade,
    );

    const versionMismatch =
      assignmentAttempt.assignmentVersionId !== null &&
      assignment.currentVersionId !== null &&
      assignmentAttempt.assignmentVersionId !== assignment.currentVersionId;

    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      showQuestions: assignment.showQuestions,
      correctAnswerVisibility:
        assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      currentVersionId: assignment.currentVersionId,
      versionMismatch,
    };
  }

  /**
   * Updates an attempt for a learner.
   *
   * Uses a 3-phase grading flow:
   *   Phase 1+2 — gradeQuestionsForLearner: load question DTOs (short tx) + LLM grading (no tx)
   *   Grade computation + validation (in-memory)
   *   LTI callback (external, before DB commit)
   *   Phase 3 — commitAttemptWithResponses: write QuestionResponse records and
   *              AssignmentAttempt.grade atomically in a single short transaction
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
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    // Allocate the per-invocation cache once and share it across both
    // pre-translate and grading phases. Without this hoist, callers that
    // omit `cache` (notably the SSE submission path,
    // updateAssignmentAttemptWithSSE) cause preTranslateQuestions to issue
    // its own findUnique calls per variant before gradeQuestionsForLearner
    // allocates its own fresh cache and re-issues the same lookups during
    // its Phase-0 hoist.
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
        throw new ConflictException(
          `Attempt ${attemptId} has already been submitted.`,
        );
      }

      if (
        this.validationService.isAttemptExpired(assignmentAttempt.expiresAt)
      ) {
        const expiredResult = await this.handleExpiredAttempt(attemptId);
        return expiredResult;
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

      if (!assignment) {
        throw new NotFoundException(
          `Assignment with Id ${assignmentId} not found.`,
        );
      }

      const servedQuestionIds = assignmentAttempt.questionOrder?.length
        ? assignmentAttempt.questionOrder
        : assignment.questionOrder?.length
          ? assignment.questionOrder
          : assignment.questions.map((question) => question.id);
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

      if (progressCallback) {
        await progressCallback("Pre-translating questions...", 10);
      }

      const preTranslatedQuestions =
        await this.translationService.preTranslateQuestions(
          updateDto.responsesForQuestions,
          assignmentAttempt,
          updateDto.language,
          effectiveCache,
        );

      updateDto.preTranslatedQuestions = preTranslatedQuestions;

      if (assignment.requireAllQuestions) {
        const optionalQuestionIdsValue: unknown =
          assignment.optionalQuestionIds;
        const optionalQuestionIdList = Array.isArray(optionalQuestionIdsValue)
          ? optionalQuestionIdsValue.filter(
              (questionId): questionId is number =>
                typeof questionId === "number" && !Number.isNaN(questionId),
            )
          : [];
        const optionalQuestionIds = new Set<number>(optionalQuestionIdList);
        let questionOrder = assignmentAttempt.questionOrder;
        if (!questionOrder || questionOrder.length === 0) {
          questionOrder =
            assignment.questionOrder?.length > 0
              ? assignment.questionOrder
              : (assignment.questions?.map((question) => question.id) ?? []);
        }
        const requiredQuestionIds = questionOrder.filter(
          (questionId) => !optionalQuestionIds.has(questionId),
        );
        const responseMap = new Map(
          updateDto.responsesForQuestions.map((response) => [
            response.id,
            response,
          ]),
        );
        const unansweredQuestionIds = requiredQuestionIds.filter(
          (questionId) => !this.hasLearnerResponse(responseMap.get(questionId)),
        );

        if (unansweredQuestionIds.length > 0) {
          throw new UnprocessableEntityException(
            `All required questions must be answered before submitting (${unansweredQuestionIds.length} unanswered).`,
          );
        }
      }

      // ── Phases 1+2: Load question DTOs (short tx) + grade with LLM (no tx) ──
      const gradedItems: GradedItem[] =
        await this.questionResponseService.gradeQuestionsForLearner(
          updateDto.responsesForQuestions,
          attemptId,
          assignmentId,
          updateDto.language,
          updateDto.preTranslatedQuestions,
          effectiveCache,
          assignmentAttempt.userId,
        );

      const successfulQuestionResponses = gradedItems.map((g) => g.responseDto);

      if (progressCallback) {
        await progressCallback("Calculating final grade...", 92);
      }

      const { totalPossiblePoints, missingQuestions } =
        await this.calculateTotalPossiblePointsWithValidation(
          successfulQuestionResponses,
          assignment.questions,
        );

      if (totalPossiblePoints <= 0) {
        this.logger.error("submitLearnerAttempt: invalid totalPossiblePoints", {
          attemptId,
          assignmentId,
          totalPossiblePoints,
          response_count: successfulQuestionResponses.length,
          question_count: assignment.questions.length,
          missing_question_count: missingQuestions.length,
        });
        throw new InternalServerErrorException(
          `Invalid totalPossiblePoints (${totalPossiblePoints}) calculated for attemptId ${attemptId}. ` +
            `This indicates a critical grading error. ` +
            `Responses: ${successfulQuestionResponses.length}, ` +
            `Questions: ${assignment.questions.length}`,
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

      if (gradingCallbackRequired) {
        if (progressCallback) {
          await progressCallback("Sending grade to LTI...", 95);
        }
        await this.handleLtiGradeCallback(
          attemptId,
          grade,
          authCookie,
          assignmentId,
          request.userSession.userId,
        );
      }

      if (progressCallback) {
        await progressCallback("Finalizing results...", 98);
      }

      // ── Phase 3: Atomic write (QuestionResponse records + AssignmentAttempt.grade) ──
      const result =
        await this.questionResponseService.commitAttemptWithResponses(
          attemptId,
          gradedItems,
          grade,
          updateDto,
        );

      await this.pruneAutoSavedResponses(
        attemptId,
        successfulQuestionResponses,
      );

      if (progressCallback) {
        await progressCallback("Grading completed!", 100);
      }

      return {
        id: result.id,
        submitted: result.submitted,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        grade: assignment.showAssignmentScore ? result.grade : undefined,
        showQuestions: assignment.showQuestions,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        correctAnswerVisibility:
          assignment.currentVersion?.correctAnswerVisibility || "NEVER",
        feedbacksForQuestions:
          this.gradingService.constructFeedbacksForQuestions(
            successfulQuestionResponses,
            assignment,
          ),
      };
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
   * Updates an attempt for an author (preview mode)
   */
  private async updateAuthorAttempt(
    assignmentId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    progressCallback?: (
      progress: string,
      percentage?: number,
      details?: GradingProgressDetails,
    ) => Promise<void>,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
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

      return {
        id: -1,
        submitted: true,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        // The preview must mirror the learner submit response (including
        // withholding the grade when the score is hidden) — it's often the
        // author's only way to see what learners actually experience.
        grade: assignment.showAssignmentScore ? grade : undefined,
        showQuestions: assignment.showQuestions,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        correctAnswerVisibility:
          assignment.currentVersion?.correctAnswerVisibility || "NEVER",
        feedbacksForQuestions:
          this.gradingService.constructFeedbacksForQuestions(
            successfulQuestionResponses,
            assignment,
          ),
      };
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
   * Handle an expired attempt
   */
  private async handleExpiredAttempt(
    attemptId: number,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    await this.prisma.assignmentAttempt.update({
      where: { id: attemptId },
      data: {
        submitted: true,
        grade: 0,
        comments:
          "You submitted the assignment after the deadline. Your submission will not be graded. If you don't have any more attempts, please contact your instructor.",
      },
    });

    return {
      id: attemptId,
      submitted: true,
      success: true,
      totalPointsEarned: 0,
      totalPossiblePoints: 0,
      grade: 0,
      showSubmissionFeedback: false,
      feedbacksForQuestions: [],
      message: "The attempt deadline has passed.",
      showQuestions: false,
      correctAnswerVisibility: "NEVER",
    };
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
    const text = response.learnerTextResponse?.trim() ?? "";
    const hasText =
      text.length > 0 && response.learnerTextResponse !== "<p><br></p>";
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

  /**
   * Applies visibility settings to questions according to the assignment configuration
   */
  private applyVisibilitySettings(
    questions: AssignmentAttemptQuestions[],
    assignmentAttempt: AssignmentAttempt & {
      questionVariants: {
        questionId: number;
      }[];
      questionResponses: {
        id: number;
        assignmentAttemptId: number;
        questionId: number;
        learnerResponse: string;
        points: number;
        feedback: JsonValue;
        metadata: JsonValue | null;
        gradedAt: Date | null;
      }[];
    },
    assignment: {
      showAssignmentScore?: boolean;
      showSubmissionFeedback?: boolean;
      showQuestionScore?: boolean;
      showQuestions?: boolean;
      showCorrectAnswer?: boolean;
    },
  ): void {
    if (assignment.showAssignmentScore === false) {
      assignmentAttempt.grade = null;
    }

    for (const question of questions) {
      if (assignment.showSubmissionFeedback === false) {
        for (const response of question.questionResponses || []) {
          if (response.feedback) {
            response.feedback = null;
          }
        }
      }

      if (assignment.showQuestionScore === false) {
        for (const response of question.questionResponses || []) {
          if (response.points !== undefined) {
            response.points = -1;
          }
        }
      }
    }
    if (assignment.showQuestions === false) {
      questions.length = 0;
      assignmentAttempt.questionResponses.length = 0;
      assignmentAttempt.questionVariants.length = 0;
    }
  }

  /**
   * Remove sensitive data from questions
   */

  private removeSensitiveData(
    questions: AttemptQuestionDto[],
    assignment: { correctAnswerVisibility: CorrectAnswerVisibility },
    grade: number,
    passingGrade: number,
  ): void {
    for (const question of questions) {
      if (!question.scoring?.showRubricsToLearner) {
        delete question.scoring?.rubrics;
      }

      question.authorComment = null;
      if (question.choices) {
        for (const choice of question.choices) {
          delete choice.points;
          if (
            !this.shouldShowCorrectAnswers(
              assignment.correctAnswerVisibility || "NEVER",
              grade,
              passingGrade,
            )
          ) {
            delete choice.isCorrect;
            delete choice.feedback;
          }
        }
      }

      if (question.translations) {
        for (const lang in question.translations) {
          const translationObject = question.translations[lang];
          if (translationObject?.translatedChoices) {
            for (const choice of translationObject.translatedChoices) {
              delete choice.points;
              if (
                !this.shouldShowCorrectAnswers(
                  assignment.correctAnswerVisibility,
                  grade,
                  passingGrade,
                )
              ) {
                delete choice.isCorrect;
                delete choice.feedback;
              }
            }
          }
        }
      }

      if (
        question.randomizedChoices &&
        typeof question.randomizedChoices === "string"
      ) {
        const randomizedArray = JSON.parse(
          question.randomizedChoices,
        ) as Array<{
          points?: number;
          isCorrect?: boolean;
          feedback?: string;
          [key: string]: any;
        }>;
        if (Array.isArray(randomizedArray)) {
          for (const choice of randomizedArray) {
            delete choice.points;
            if (
              !this.shouldShowCorrectAnswers(
                assignment.correctAnswerVisibility || "NEVER",
                grade,
                passingGrade,
              )
            ) {
              delete choice.isCorrect;
              delete choice.feedback;
            }
          }
          question.randomizedChoices = JSON.stringify(randomizedArray);
        } else {
          question.randomizedChoices = JSON.stringify([]);
        }
      }

      delete question.answer;
    }
  }

  private applyAnswerVisibilityToQuestionDtos(
    questions: EnhancedAttemptQuestionDto[],
    shouldShowCorrectAnswers: boolean,
  ): EnhancedAttemptQuestionDto[] {
    return questions.map((question) => ({
      ...question,
      answer: shouldShowCorrectAnswers ? question.answer : undefined,
    }));
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
   * Get normalized language code
   */
  private getNormalizedLanguage(language?: string): string {
    if (!language) {
      return "en";
    }
    return language.toLowerCase().split("-")[0];
  }

  /**
   * Determine if correct answers should be shown based on visibility setting and grade
   */
  private shouldShowCorrectAnswers(
    correctAnswerVisibility: CorrectAnswerVisibility,
    grade: number,
    passingGrade: number,
  ): boolean {
    switch (correctAnswerVisibility) {
      case "NEVER": {
        return false;
      }
      case "ALWAYS": {
        return true;
      }
      case "ON_PASS": {
        return grade >= passingGrade;
      }
      default: {
        return false;
      }
    }
  }
}
