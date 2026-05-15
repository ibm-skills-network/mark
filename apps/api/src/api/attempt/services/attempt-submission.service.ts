/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/no-null */
import {
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
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "../common/utils/attempt-questions-mapper.util";
import { AttemptAccessCacheService } from "./attempt-access-cache.service";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { LtiGradeSyncService } from "./lti-grade-sync.service";
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
    const responseDto =
      await this.questionResponseService.createQuestionResponse(
        attemptId,
        { ...requestDto, id: questionId },
        userSession.role,
        assignmentId,
        language,
      );

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

    const existingAttempt = await this.prisma.assignmentAttempt.findFirst({
      where: {
        assignmentId,
        userId: userSession.userId,
        submitted: false,
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
      orderBy: { createdAt: "desc" },
    });

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

    await this.validationService.validateNewAttempt(
      assignmentForAttemptFlow,
      userSession,
    );

    const attemptExpiresAt = this.calculateAttemptExpiresAt(
      assignmentForAttemptFlow,
    );
    const activeVersionId = assignment.currentVersionId;

    const assignmentAttempt = await this.prisma.assignmentAttempt.create({
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

    if (
      assignment.numberOfQuestionsPerAttempt &&
      assignment.numberOfQuestionsPerAttempt > 0
    ) {
      const shuffledQuestions = this.deterministicShuffle(
        questions,
        selectionSeed,
      );
      const selectedQuestions = shuffledQuestions.slice(
        0,
        assignment.numberOfQuestionsPerAttempt,
      );
      if (selectedQuestions.length < assignment.numberOfQuestionsPerAttempt) {
        throw new NotFoundException(
          `Not enough questions available for the assignment with Id ${assignmentId}.`,
        );
      }
      questions.length = 0;
      questions.push(...selectedQuestions);
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

    await this.prisma.assignmentAttempt.update({
      where: { id: assignmentAttempt.id },
      data: {
        questionOrder: orderedQuestions.map((q) => q.id),
      },
    });

    await this.questionVariantService.createAttemptQuestionVariants(
      assignmentAttempt.id,
      orderedQuestions,
    );

    return {
      id: assignmentAttempt.id,
      success: true,
    };
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
    progressCallback?: (progress: string, percentage?: number) => Promise<void>,
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

    const shouldShowCorrectAnswers = this.shouldShowCorrectAnswers(
      assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      assignmentAttempt.grade || 0,
      assignment.passingGrade,
    );

    const cachedQuestions =
      await this.attemptAccessCacheService.getQuestionDtosForAttemptAccess({
        assignmentId: assignmentAttempt.assignmentId,
        assignmentUpdatedAt: assignment.updatedAt,
        assignmentVersionId: assignmentAttempt.assignmentVersionId,
        questionVersions:
          assignmentAttempt.assignmentVersion?.questionVersions ?? [],
      });

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

    // Compute score totals BEFORE applyVisibilitySettings so they survive
    // even when showQuestions=false strips the questions array. Without this
    // the success page shows "0 / 0" because it can't sum the (empty) array.
    const totalPossiblePoints = finalQuestions.reduce(
      (sum, q) => sum + (q.totalPoints ?? 0),
      0,
    );
    const totalPointsEarned = (
      assignmentAttempt.questionResponses ?? []
    ).reduce((sum, response) => sum + (response.points ?? 0), 0);

    this.applyVisibilitySettings(finalQuestions, assignmentAttempt, assignment);

    return {
      ...assignmentAttempt,
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
    };
  }

  /**
   * Updates an attempt for a learner.
   *
   * Uses a 3-phase grading flow (Changes 2+3):
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
    progressCallback?: (progress: string, percentage?: number) => Promise<void>,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
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

      if (
        this.validationService.isAttemptExpired(assignmentAttempt.expiresAt)
      ) {
        const expiredResult = await this.handleExpiredAttempt(attemptId);
        return expiredResult;
      }

      if (progressCallback) {
        await progressCallback("Pre-translating questions...", 10);
      }

      const preTranslatedQuestions =
        await this.translationService.preTranslateQuestions(
          updateDto.responsesForQuestions,
          assignmentAttempt,
          updateDto.language,
        );

      updateDto.preTranslatedQuestions = preTranslatedQuestions;

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

      if (assignment?.requireAllQuestions) {
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
    progressCallback?: (progress: string, percentage?: number) => Promise<void>,
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
