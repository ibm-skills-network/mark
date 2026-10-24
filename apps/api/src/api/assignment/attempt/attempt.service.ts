/* eslint-disable unicorn/no-null */
import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  OnModuleDestroy,
  UnprocessableEntityException,
} from "@nestjs/common";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { Logger } from "winston";
import IORedis from "ioredis";
import { createCacheRedisConnection } from "src/job-queue/redis.connection";
import { Question, RegradingStatus, ReportType } from "@prisma/client";
import { meetsPassingGrade } from "src/api/attempt/common/utils/pass-fail.util";
import { GradingKillSwitchService } from "src/api/ai-feature-flags/grading-kill-switch.service";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { applyQuestionOrder } from "../utils/question-order.util";
import { PrismaService } from "../../../database/prisma.service";
import type { LegacyLearnerGetAssignmentResponseDto } from "../dto/get.assignment.response.dto";
import { AttemptQuestionDto } from "../dto/update.questions.request.dto";
import { Choice } from "../question/dto/create.update.question.request.dto";
import { AssignmentServiceV1 } from "../v1/services/assignment.service";
import {
  ATTEMPT_IN_PROGRESS_CODE,
  ATTEMPT_MAX_REACHED_CODE,
  ATTEMPT_TIME_RANGE_EXCEEDED_CODE,
  IN_COOLDOWN_PERIOD,
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "./dto/assignment-attempt/base.assignment.attempt.response.dto";
import {
  AssignmentFeedbackDto,
  AssignmentFeedbackResponseDto,
  RegradingRequestDto,
  RegradingStatusResponseDto,
  RequestRegradingResponseDto,
} from "./dto/assignment-attempt/feedback.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import type { AssignmentAttemptQuestions } from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import { readServerClock } from "./helper/server-clock.helper";

type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
  assignmentAttemptId?: number;
  learnerResponse?: string;
  points: number;
  feedback: object;
  gradedAt?: Date;
};

@Injectable()
export class AttemptServiceV1 implements OnModuleDestroy {
  private readonly logger: Logger;
  private redis?: IORedis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly assignmentService: AssignmentServiceV1,
    private readonly gradingKillSwitch: GradingKillSwitchService,
    @Inject(WINSTON_MODULE_PROVIDER) parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({ context: AttemptServiceV1.name });
    this.redis = this.createRedisClient();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {
        // Ignore teardown failures — the connection is being torn down anyway.
      });
    }
  }

  private createRedisClient(): IORedis | undefined {
    try {
      const client = createCacheRedisConnection();
      client.on("error", (error) => {
        this.logger.warn(
          `attempt.redis.error { message: ${JSON.stringify(error.message)} }`,
        );
      });
      return client;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.logger.warn(
        `attempt.redis.unavailable { reason: ${JSON.stringify(message)} }`,
      );
      return undefined;
    }
  }

  async submitFeedback(
    assignmentId: number,
    attemptId: number,
    feedbackDto: AssignmentFeedbackDto,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to submit feedback for this attempt.",
      );
    }

    const existingFeedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (existingFeedback) {
      const updatedFeedback = await this.prisma.assignmentFeedback.update({
        where: { id: existingFeedback.id },
        data: {
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        id: updatedFeedback.id,
      };
    } else {
      const feedback = await this.prisma.assignmentFeedback.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          comments: feedbackDto.comments,
          aiGradingRating: feedbackDto.aiGradingRating,
          assignmentRating: feedbackDto.assignmentRating,
        },
      });
      return {
        success: true,
        id: feedback.id,
      };
    }
  }
  async getFeedback(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<AssignmentFeedbackDto> {
    const feedback = await this.prisma.assignmentFeedback.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (!feedback) {
      return {
        comments: "",
        aiGradingRating: undefined,
        assignmentRating: undefined,
      };
    }

    return {
      comments: feedback.comments,
      aiGradingRating: feedback.aiGradingRating,
      assignmentRating: feedback.assignmentRating,
    };
  }
  async processRegradingRequest(
    assignmentId: number,
    attemptId: number,
    regradingRequestDto: RegradingRequestDto,
    userSession: UserSession,
  ): Promise<RequestRegradingResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `Assignment attempt with ID ${attemptId} not found.`,
      );
    }

    if (assignmentAttempt.assignmentId !== assignmentId) {
      throw new BadRequestException(
        "Assignment ID does not match the attempt.",
      );
    }

    if (assignmentAttempt.userId !== userSession.userId) {
      throw new ForbiddenException(
        "You do not have permission to request regrading for this attempt.",
      );
    }

    const existingRegradingRequest =
      await this.prisma.assignmentFeedback.findFirst({
        where: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
        },
      });

    if (existingRegradingRequest) {
      const updatedRegradingRequest = await this.prisma.regradingRequest.update(
        {
          where: { id: existingRegradingRequest.id },
          data: {
            regradingReason: regradingRequestDto.reason,
            regradingStatus: RegradingStatus.PENDING,
            updatedAt: new Date(),
          },
        },
      );

      return {
        success: true,
        id: updatedRegradingRequest.id,
      };
    } else {
      const regradingRequest = await this.prisma.regradingRequest.create({
        data: {
          assignmentId: assignmentId,
          attemptId: attemptId,
          userId: userSession.userId,
          regradingReason: regradingRequestDto.reason,
          regradingStatus: RegradingStatus.PENDING,
        },
      });
      return {
        success: true,
        id: regradingRequest.id,
      };
    }
  }
  async getRegradingStatus(
    assignmentId: number,
    attemptId: number,
    userSession: UserSession,
  ): Promise<RegradingStatusResponseDto> {
    const regradingRequest = await this.prisma.regradingRequest.findFirst({
      where: {
        assignmentId: assignmentId,
        attemptId: attemptId,
        userId: userSession.userId,
      },
    });

    if (!regradingRequest) {
      throw new NotFoundException(
        `Regrading request for assignment ${assignmentId} and attempt ${attemptId} not found.`,
      );
    }

    return {
      status: regradingRequest.regradingStatus,
    };
  }

  /**
   * Lists assignment attempts for the given assignment and user session.
   * @param assignmentId The ID of the assignment.
   * @param userSession The user session.
   * @returns A list of assignment attempt response DTOs.
   */
  async listAssignmentAttempts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<AssignmentAttemptResponseDto[]> {
    const { userId, role } = userSession;

    return role === UserRole.AUTHOR
      ? this.prisma.assignmentAttempt.findMany({
          where: { assignmentId },
          include: {
            assignmentVersion: {
              select: {
                id: true,
                versionNumber: true,
                isDraft: true,
                isActive: true,
                published: true,
              },
            },
          },
        })
      : this.prisma.assignmentAttempt.findMany({
          where: { assignmentId, userId },
          include: {
            assignmentVersion: {
              select: {
                id: true,
                versionNumber: true,
                isDraft: true,
                isActive: true,
                published: true,
              },
            },
          },
        });
  }

  /**
   * - Database record creation for attempt tracking
   *
   * @param assignmentId - ID of assignment to attempt. Must be active and available to user.
   * @param userSession - Authenticated user session containing user ID and permissions.
   * @returns Promise resolving to object containing new attempt ID and success status.
   *
   * @remarks
   * 1. Validates user can attempt assignment (checks limits, availability, etc.)
   * 2. Creates base attempt record with expiration time
   * 3. Determines question order:
   *    - Random shuffle if assignment specifies random ordering
   *    - Predefined order if assignment has questionOrder array
   *    - Natural order otherwise
   * 4. For each question:
   *    - Randomly selects between original question or its variants
   *    - Randomizes answer choices if enabled (per question/variant config)
   * 5. Stores attempt metadata including:
   *    - Final question order
   *    - Selected variants
   *    - Randomized choice sequences
   *
   * @throws NotFoundException if assignment doesn't exist
   * @throws ForbiddenException if user can't attempt assignment
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    const assignment = await this.assignmentService.findOne(
      assignmentId,
      userSession,
    );
    // Kill-switch: block starting an AI-graded attempt while grading is
    // disabled (non-AI assignments are unaffected).
    await this.gradingKillSwitch.assertGradingAllowed(
      assignmentId,
      userSession.userId,
      "start",
    );
    await this.validateNewAttempt(assignment, userSession);
    const attemptExpiresAt = this.calculateAttemptExpiresAt(assignment);
    const assignmentAttempt = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId,
        grade: undefined,
        userId: userSession.userId,
        questionOrder: [],
      },
    });

    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId,
        isDeleted: false,
      },
      include: {
        variants: {
          where: { isDeleted: false },
        },
      },
    });

    const cap = assignment.numberOfQuestionsPerAttempt;
    if (cap && cap > 0 && questions.length > cap) {
      for (let index = questions.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [questions[index], questions[swapIndex]] = [
          questions[swapIndex],
          questions[index],
        ];
      }
      questions.splice(cap);
    }

    if (assignment.displayOrder === "RANDOM") {
      for (let index = questions.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [questions[index], questions[swapIndex]] = [
          questions[swapIndex],
          questions[index],
        ];
      }
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      questions.splice(
        0,
        questions.length,
        ...applyQuestionOrder(questions, assignment.questionOrder),
      );
    }

    await this.prisma.assignmentAttempt.update({
      where: { id: assignmentAttempt.id },
      data: {
        questionOrder: questions.map((q) => q.id),
      },
    });

    const attemptQuestionVariantsData = questions.map((question) => {
      const questionAndVariants = [undefined, ...question.variants];
      const randomIndex = Math.floor(
        Math.random() * questionAndVariants.length,
      );
      const chosenVariant = questionAndVariants[randomIndex];

      let variantId: number | null;
      let randomizedChoices: string | null;

      if (chosenVariant) {
        variantId = chosenVariant.id ?? undefined;
        randomizedChoices = this.maybeShuffleChoices(
          chosenVariant.choices as unknown as Choice[],
          chosenVariant.randomizedChoices === true,
        );
      } else {
        randomizedChoices = this.maybeShuffleChoices(
          question.choices as unknown as Choice[],
          question.randomizedChoices === true,
        );
      }

      return {
        assignmentAttemptId: assignmentAttempt.id,
        questionId: question.id,
        questionVariantId: variantId,
        randomizedChoices,
      };
    });

    await this.prisma.assignmentAttemptQuestionVariant.createMany({
      data: attemptQuestionVariantsData,
    });

    return {
      id: assignmentAttempt.id,
      success: true,
      serverNow: readServerClock(),
    };
  }

  /**
   * Retrieves and formats a completed assignment attempt with contextual display rules.
   *
   * Aggregates attempt data including questions, chosen variants, responses, and scoring while
   * enforcing assignment-specific visibility settings.
   *
   * @param assignmentAttemptId - ID of the attempt to retrieve
   * @param language - The language code requested (if none provided, defaults to "en")
   * @returns Structured attempt data with:
   * - Questions in their attempt-specific order
   * - Merged question/variant data including translations for the requested
   *   language family only (the client refetches on language switch)
   * - Responses with score/feedback visibility rules applied
   * - Assignment configuration metadata
   *
   * @remarks
   * See inline comments for details on how translations are fetched and merged.
   *
   * @throws NotFoundException If the attempt or related assignment cannot be found
   * @throws BadRequestException For malformed stored data (invalid JSON formats)
   */
  async getAssignmentAttempt(
    assignmentAttemptId: number,
    language: string,
  ): Promise<GetAssignmentAttemptResponseDto> {
    if (!language) {
      language = "en";
    }
    const normalizedLanguage = language.toLowerCase().split("-")[0];

    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
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
      },
    });
    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        id: true,
        name: true,
        introduction: true,
        instructions: true,
        gradingCriteriaOverview: true,
        timeEstimateMinutes: true,
        attemptsBeforeCoolDown: true,
        retakeAttemptCoolDownMinutes: true,
        type: true,
        graded: true,
        numAttempts: true,
        allotedTimeMinutes: true,
        requireAllQuestions: true,
        optionalQuestionIds: true,
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        questionDisplay: true,
        numberOfQuestionsPerAttempt: true,
        published: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        showPassFailIndicator: true,
        questionControls: true,
        updatedAt: true,
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
            questionControls: true,
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }

    const correctAnswerVisibility =
      assignment.currentVersion?.correctAnswerVisibility || "NEVER";
    const questionControls = (assignment.currentVersion?.questionControls ??
      assignment.questionControls ??
      undefined) as GetAssignmentAttemptResponseDto["questionControls"];

    const questionOrder =
      assignmentAttempt.questionOrder || assignment.questionOrder || [];

    const questionById = new Map(assignment.questions.map((q) => [q.id, q]));

    const questionIds = assignment.questions.map((q) => q.id);
    const variantIds = assignmentAttempt.questionVariants
      .map((qv) => qv.questionVariant?.id)
      .filter((id) => id != undefined);

    // Only the requested language family is fetched (startsWith covers
    // regional rows like zh-CN/zh-TW for a zh request). Returning every
    // language made the response size scale with the translation count — an
    // assignment with images embedded in its question HTML shipped each image
    // once per language (assignment 2532 reached ~4MB, overflowing
    // localStorage on the client and trapping learners in a clear-and-reload
    // loop). The client refetches the attempt when the learner switches
    // language mid-attempt.
    const translations = await this.prisma.translation.findMany({
      where: {
        languageCode: { startsWith: normalizedLanguage },
        OR: [
          { questionId: { in: questionIds } },
          ...(variantIds.length > 0 ? [{ variantId: { in: variantIds } }] : []),
        ],
      },
    });

    const translationMap = new Map<
      string,
      Record<string, { translatedText: string; translatedChoices: any }>
    >();
    for (const t of translations) {
      const key = t.variantId
        ? `variant-${t.variantId}`
        : `question-${t.questionId}`;
      if (!translationMap.has(key)) {
        translationMap.set(key, {});
      }
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      translationMap.get(key)![t.languageCode] = {
        translatedText: t.translatedText,
        translatedChoices: t.translatedChoices,
      };
    }

    const questionVariantsArray = assignmentAttempt.questionVariants ?? [];

    const questionsWithVariants = questionVariantsArray?.map((qv) => {
      const variant = qv.questionVariant;
      const originalQ = questionById.get(qv.questionId);

      const variantTranslations = variant
        ? translationMap.get(`variant-${variant.id}`) || {}
        : {};
      const questionTranslations = variant
        ? {}
        : translationMap.get(`question-${qv.questionId}`) || {};

      const translationFallback = {
        translatedText: variant
          ? variant.variantContent || originalQ?.question
          : originalQ?.question,
        translatedChoices: variant
          ? (variant?.choices as unknown as Choice[]) ||
            (originalQ?.choices as unknown as Choice[])
          : (originalQ?.choices as unknown as Choice[]),
      };

      const primaryTranslation =
        (variant
          ? variantTranslations[normalizedLanguage]
          : questionTranslations[normalizedLanguage]) || translationFallback;

      const baseChoicesRaw = variant?.choices ?? originalQ?.choices;

      const normalizedChoices: Choice[] = this.parseChoices(baseChoicesRaw);

      if (!Array.isArray(normalizedChoices)) {
        this.logger.error("Malformed choices for question", {
          question_id: originalQ.id,
          choices_type: typeof baseChoicesRaw,
          choices_preview:
            typeof baseChoicesRaw === "string"
              ? baseChoicesRaw.slice(0, 200)
              : undefined,
        });
        throw new InternalServerErrorException(
          `Malformed choices for question ${originalQ.id}`,
        );
      }
      let finalChoices = normalizedChoices;

      if (qv.randomizedChoices) {
        let randomizedChoicesArray: Choice[] = [];
        if (typeof qv.randomizedChoices === "string") {
          try {
            randomizedChoicesArray = JSON.parse(
              qv.randomizedChoices,
            ) as Choice[];
          } catch (parseError) {
            this.logger.warn(
              "Failed to JSON.parse randomizedChoices, falling back to []",
              {
                question_id: originalQ.id,
                error:
                  parseError instanceof Error
                    ? parseError.message
                    : String(parseError),
              },
            );
            randomizedChoicesArray = [];
          }
        } else {
          randomizedChoicesArray = qv.randomizedChoices as unknown as Choice[];
        }
        const permutation = randomizedChoicesArray?.map((rChoice) => {
          if (rChoice.id !== undefined) {
            return normalizedChoices?.findIndex((bc) => bc.id === rChoice.id);
          }
          return normalizedChoices?.findIndex(
            (bc) => bc.choice === rChoice.choice,
          );
        });
        const orderedBaseChoices = permutation?.map(
          (index) => normalizedChoices[index],
        );
        if (orderedBaseChoices?.length === normalizedChoices?.length) {
          finalChoices = orderedBaseChoices;
        }

        const translationsForThisQuestion = variant
          ? variantTranslations
          : questionTranslations;
        for (const lang in translationsForThisQuestion) {
          const translationObject = translationsForThisQuestion[lang];
          if (
            translationObject &&
            Array.isArray(translationObject.translatedChoices) &&
            translationObject.translatedChoices.length ===
              normalizedChoices.length
          ) {
            const origTranslatedChoices =
              translationObject.translatedChoices as Choice[];
            const reorderedTranslatedChoices = permutation.map(
              (index) => origTranslatedChoices[index],
            );
            translationObject.translatedChoices = reorderedTranslatedChoices;
          }
        }
      }

      return {
        id: originalQ.id,
        question: primaryTranslation.translatedText || originalQ?.question,
        choices: finalChoices,
        authorComment: originalQ.authorComment ?? null,
        translations: variant ? variantTranslations : questionTranslations,
        maxWords: variant?.maxWords ?? originalQ?.maxWords,
        maxCharacters: variant?.maxCharacters ?? originalQ?.maxCharacters,
        scoring: variant?.scoring ?? originalQ?.scoring,
        totalPoints: originalQ.totalPoints,
        answer: variant?.answer ?? originalQ?.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ?.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: qv.randomizedChoices,
        videoPresentationConfig:
          originalQ.videoPresentationConfig as unknown as JSON,
        liveRecordingConfig: originalQ.liveRecordingConfig as unknown as JSON,
      };
    });

    const questionVariantsMap = new Map(
      questionsWithVariants.map((question) => [question.id, question]),
    );

    const questions: Question[] = await this.prisma.question.findMany({
      where: { assignmentId: assignmentAttempt.assignmentId },
    });
    const nonVariantQuestions = questions.filter(
      (originalQ) => !questionVariantsMap.has(originalQ.id),
    );

    const mergedQuestions = [
      ...questionVariantsMap.values(),
      ...nonVariantQuestions,
    ];

    const finalQuestions =
      questionOrder.length > 0
        ? questionOrder
            .map((qId) => mergedQuestions.find((q) => q.id === qId))
            .filter(Boolean)
        : mergedQuestions;

    for (const question of finalQuestions as unknown as AttemptQuestionDto[]) {
      if (!question.scoring?.showRubricsToLearner) {
        delete question.scoring?.rubrics;
      }

      if (question.choices) {
        for (const choice of question.choices) {
          delete choice.points;
          if (
            correctAnswerVisibility === "ON_PASS" &&
            !meetsPassingGrade(assignmentAttempt.grade, assignment.passingGrade)
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
                correctAnswerVisibility === "ON_PASS" &&
                !meetsPassingGrade(
                  assignmentAttempt.grade,
                  assignment.passingGrade,
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
        ) as Choice[];
        for (const choice of randomizedArray) {
          delete choice.points;
          if (
            correctAnswerVisibility === "ON_PASS" &&
            !meetsPassingGrade(assignmentAttempt.grade, assignment.passingGrade)
          ) {
            delete choice.isCorrect;
            delete choice.feedback;
          }
        }
        question.randomizedChoices = JSON.stringify(randomizedArray);
      }

      if (
        correctAnswerVisibility === "ON_PASS" &&
        !meetsPassingGrade(assignmentAttempt.grade, assignment.passingGrade)
      ) {
        delete question.answer;
      }
    }

    // No pass/fail verdict here on purpose — see the v2 twin in
    // attempt-submission.service.ts. This route serves the in-progress
    // attempt; pass/fail belongs to the completed and submit responses.
    return {
      ...assignmentAttempt,
      serverNow: readServerClock(),
      // The spread carries the persisted grade, which must not reach a learner
      // whose assignment hides the score.
      grade: assignment.showAssignmentScore ? assignmentAttempt.grade : null,
      questions: finalQuestions.map((question) => ({
        ...question,
        choices:
          typeof question.choices === "string"
            ? (JSON.parse(question.choices) as Choice[])
            : question.choices,
      })) as AssignmentAttemptQuestions[],
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      showQuestions: assignment.showQuestions,
      correctAnswerVisibility,
      questionControls,
      assignmentDetails: {
        id: assignment.id,
        name: assignment.name,
        introduction: assignment.introduction,
        instructions: assignment.instructions,
        gradingCriteriaOverview: assignment.gradingCriteriaOverview,
        timeEstimateMinutes: assignment.timeEstimateMinutes,
        attemptsBeforeCoolDown: assignment.attemptsBeforeCoolDown,
        retakeAttemptCoolDownMinutes: assignment.retakeAttemptCoolDownMinutes,
        type: assignment.type,
        graded: assignment.graded,
        numAttempts: assignment.numAttempts,
        allotedTimeMinutes: assignment.allotedTimeMinutes,
        requireAllQuestions: assignment.requireAllQuestions,
        optionalQuestionIds: assignment.optionalQuestionIds,
        passingGrade: assignment.passingGrade,
        displayOrder: assignment.displayOrder,
        questionDisplay: assignment.questionDisplay,
        numberOfQuestionsPerAttempt: assignment.numberOfQuestionsPerAttempt,
        questionOrder: assignment.questionOrder,
        published: assignment.published,
        showAssignmentScore: assignment.showAssignmentScore,
        showQuestionScore: assignment.showQuestionScore,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        showQuestions: assignment.showQuestions,
        showPassFailIndicator: assignment.showPassFailIndicator,
        correctAnswerVisibility,
        questionControls,
        updatedAt: assignment.updatedAt,
      },
    };
  }

  /**
   * Creates a report for a given assignment attempt.
   *
   * @param {number} assignmentId - The unique identifier of the assignment being reported.
   * @param {number} attemptId - The unique identifier of the specific attempt being reported.
   * @param {ReportType} issueType - The type of issue being reported (e.g., plagiarism, system error).
   * @param {string} description - A detailed description of the issue.
   * @param {string} userId - The unique identifier of the user creating the report.
   *
   * @returns {Promise<void>} - A promise that resolves when the report is successfully created.
   *
   * @throws {NotFoundException} - If the specified assignment does not exist.
   * @throws {NotFoundException} - If the specified assignment attempt does not exist.
   * @throws {UnprocessableEntityException} - If the user has already submitted 5 or more reports in the last 24 hours.
   *
   * @description
   * This function ensures that a report is created under the following conditions:
   * - The assignment exists in the database.
   * - The assignment attempt exists.
   * - The user has not exceeded the limit of 5 reports in the past 24 hours.
   *
   * The function first checks whether the given `assignmentId` corresponds to an existing assignment in the database.
   * If the assignment does not exist, it throws a `NotFoundException`.
   *
   * Next, it verifies that the given `attemptId` corresponds to an existing assignment attempt.
   * If the attempt does not exist, it throws a `NotFoundException`.
   *
   * Then, it checks how many reports the user has submitted in the last 24 hours.
   * If the user has already submitted 5 or more reports, it throws an `UnprocessableEntityException`.
   *
   * If all conditions are met, the function proceeds to create a new report in the database,
   * associating it with the given `assignmentId`, `attemptId`, and the reporting `userId`.
   * The report is stored with the provided `issueType` and `description`, and it sets the `author` field to `false`.
   */
  async createReport(
    assignmentId: number,
    attemptId: number,
    issueType: ReportType,
    description: string,
    userId: string,
  ): Promise<void> {
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }

    // The route's ids come from the client: the attempt must be the
    // reporter's own and belong to this assignment. Every refusal looks the
    // same, so the endpoint cannot be used to probe for other attempts.
    const attempt =
      Number.isSafeInteger(attemptId) && attemptId > 0
        ? await this.prisma.assignmentAttempt.findUnique({
            where: { id: attemptId },
            select: { userId: true, assignmentId: true },
          })
        : null;
    if (
      !attempt ||
      attempt.userId !== userId ||
      attempt.assignmentId !== assignmentId
    ) {
      this.logger.warn("createReport: attempt not reportable by this user", {
        user_id: userId,
        assignment_id: assignmentId,
        attempt_id: attemptId,
        reason: attempt
          ? attempt.userId === userId
            ? "assignment_mismatch"
            : "not_owner"
          : "not_found",
      });
      throw new NotFoundException("Assignment attempt not found");
    }

    const reports = await this.prisma.report.findMany({
      where: {
        reporterId: userId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });
    if (reports.length >= 5) {
      throw new UnprocessableEntityException(
        "You have reached the maximum number of reports allowed in a 24-hour period.",
      );
    }

    await this.prisma.report.create({
      data: {
        assignmentId,
        attemptId,
        issueType,
        description,
        reporterId: userId,
        author: false,
      },
    });
  }

  /**
   * Auto-grades an expired attempt using the last saved question responses.
   * This ensures learners get credit for their work even if they don't manually submit before timeout.
   *
   * @param attemptId - The ID of the expired attempt to grade
   * @param assignment - The assignment object for grading context
   * @returns Promise that resolves when grading is complete
   */
  private async autoGradeExpiredAttempt(
    attemptId: number,
    assignment: LegacyLearnerGetAssignmentResponseDto,
  ): Promise<void> {
    void assignment;
    const attempt = await this.prisma.assignmentAttempt.findUnique({
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
      },
    });

    if (!attempt || attempt.submitted) {
      return;
    }

    const questions = await this.prisma.question.findMany({
      where: {
        assignmentId: attempt.assignmentId,
        isDeleted: false,
      },
    });

    let totalPointsEarned = 0;
    let totalPossiblePoints = 0;

    for (const question of questions) {
      const response = attempt.questionResponses.find(
        (r) => r.questionId === question.id,
      );

      totalPossiblePoints += question.totalPoints || 0;

      if (response) {
        totalPointsEarned += response.points || 0;
      }
    }

    const grade =
      totalPossiblePoints > 0 ? totalPointsEarned / totalPossiblePoints : 0;

    await this.prisma.assignmentAttempt.update({
      where: { id: attemptId },
      data: {
        submitted: true,
        grade,
        expiresAt: new Date(),
        comments:
          attempt.questionResponses.length > 0
            ? "Your assignment was automatically submitted because the time limit was reached. Your responses have been graded based on what was saved."
            : "Your assignment was automatically submitted because the time limit was reached. No responses were recorded.",
      },
    });
  }

  /**
   * Validates whether a new attempt can be created for the given assignment and user session.
   * Now includes auto-grading of expired attempts to prevent blocking new attempts.
   *
   * @param assignment The assignment object.
   * @param userSession The user session.
   */
  private async validateNewAttempt(
    assignment: LegacyLearnerGetAssignmentResponseDto,
    userSession: UserSession,
  ): Promise<void> {
    const now = new Date();
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        OR: [
          {
            submitted: false,
            expiresAt: { gte: now },
          },
          {
            submitted: false,
            expiresAt: undefined,
          },
          {
            createdAt: { gte: timeRangeStartDate, lte: now },
          },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    const expiredAttempts = attempts.filter(
      (sub) => !sub.submitted && sub.expiresAt && sub.expiresAt < now,
    );

    for (const expiredAttempt of expiredAttempts) {
      await this.autoGradeExpiredAttempt(expiredAttempt.id, assignment);
    }

    const ongoingAttempts = attempts.filter(
      (sub) => !sub.submitted && (!sub.expiresAt || sub.expiresAt >= now),
    );

    if (ongoingAttempts.length > 0) {
      // Carry the machine-readable code (same contract as the v2 validation
      // service) so the web client can resume instead of showing the
      // "no more attempts" fallback it uses for uncoded 422s.
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ATTEMPT_IN_PROGRESS_CODE,
        message: IN_PROGRESS_SUBMISSION_EXCEPTION,
      });
    }
    const attemptsInTimeRange = attempts.filter(
      (sub) => sub.createdAt >= timeRangeStartDate && sub.createdAt <= now,
    );

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ATTEMPT_TIME_RANGE_EXCEEDED_CODE,
        message: TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      });
    }
    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const totalAttempts = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (totalAttempts >= assignment.numAttempts) {
        throw new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          code: ATTEMPT_MAX_REACHED_CODE,
          message: MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        });
      }

      const attemptsBeforeCoolDown = assignment.attemptsBeforeCoolDown ?? 1;
      const cooldownMinutes = assignment.retakeAttemptCoolDownMinutes ?? 0;

      if (
        attemptsBeforeCoolDown > 0 &&
        totalAttempts >= attemptsBeforeCoolDown
      ) {
        const latestAttempt = attemptsInTimeRange[0];
        if (latestAttempt?.expiresAt) {
          const nextEligibleTime =
            new Date(latestAttempt.expiresAt).getTime() +
            cooldownMinutes * 60_000;
          if (now.getTime() < nextEligibleTime) {
            throw new UnprocessableEntityException(IN_COOLDOWN_PERIOD);
          }
        }
      }
    }
  }

  /**
   * Calculates the expiration date for an attempt based on the assignment settings.
   * @param assignment The assignment object.
   * @returns The expiration date or null.
   */
  private calculateAttemptExpiresAt(
    assignment: LegacyLearnerGetAssignmentResponseDto,
  ): Date | null {
    if (
      assignment.allotedTimeMinutes !== undefined &&
      assignment.allotedTimeMinutes > 0
    ) {
      return new Date(Date.now() + assignment.allotedTimeMinutes * 60 * 1000);
    }
    return undefined;
  }

  private maybeShuffleChoices(
    choices: Choice[] | string | null | undefined,
    shouldShuffle: boolean,
  ): string | null {
    if (!choices) return;
    let parsed: Choice[];
    if (typeof choices === "string") {
      try {
        const temporary = JSON.parse(choices) as Choice[];
        if (!Array.isArray(temporary)) {
          return;
        }
        parsed = temporary;
      } catch (parseError) {
        this.logger.warn(
          "shuffleChoices: failed to JSON.parse choices string, returning early",
          {
            error:
              parseError instanceof Error
                ? parseError.message
                : String(parseError),
            choices_preview:
              typeof choices === "string" ? choices.slice(0, 200) : undefined,
          },
        );
        return;
      }
    } else {
      parsed = choices;
    }
    if (!Array.isArray(parsed)) {
      return;
    }
    if (shouldShuffle) {
      parsed = [...parsed];
      parsed.sort(() => Math.random() - 0.5);
    }
    return JSON.stringify(parsed);
  }

  /**
   * Calculates the time range start date based on the assignment settings.
   * @param assignment The assignment object.
   * @returns The time range start date.
   */
  private calculateTimeRangeStartDate(
    assignment: LegacyLearnerGetAssignmentResponseDto,
  ): Date {
    if (assignment.attemptsTimeRangeHours) {
      return new Date(
        Date.now() - assignment.attemptsTimeRangeHours * 60 * 60 * 1000,
      );
    }
    return new Date();
  }

  /**
   * Counts the number of attempts made by a user for a specific assignment.
   * @param userId The user ID.
   * @param assignmentId The assignment ID.
   * @returns The number of attempts.
   */
  private async countUserAttempts(
    userId: string,
    assignmentId: number,
  ): Promise<number> {
    return this.prisma.assignmentAttempt.count({
      where: {
        userId: userId,
        assignmentId: assignmentId,
      },
    });
  }

  /**
   * Constructs questions with their corresponding responses.
   * @param questions The list of questions.
   * @param questionResponses The list of question responses.
   * @returns A list of questions with responses.
   */
  private constructQuestionsWithResponses(
    questions: Question[],
    questionResponses: QuestionResponse[],
  ): AssignmentAttemptQuestions[] {
    return questions.map((question) => {
      const extendedQuestion = question as Question & { variantId?: number };
      const correspondingResponses = questionResponses
        .filter((response) => response.id === question.id)
        .map((response) => ({
          id: response.id,
          variantId: extendedQuestion.variantId || null,
          assignmentAttemptId: response.assignmentAttemptId,
          questionId: response.id,
          learnerResponse: response.learnerResponse,
          points: response.points,
          feedback: response.feedback,
          gradedAt: response.gradedAt,
          metadata: {},
        }));

      const choices: {
        choice: string;
        points: number;
        feedback: string;
        isCorrect: boolean;
      }[] = question.choices
        ? // eslint-disable-next-line unicorn/no-nested-ternary
          typeof question.choices === "string"
          ? (JSON.parse(question.choices) as {
              choice: string;
              points: number;
              feedback: string;
              isCorrect: boolean;
            }[])
          : (question.choices as {
              choice: string;
              points: number;
              feedback: string;
              isCorrect: boolean;
            }[])
        : [];

      const formattedChoices = choices?.map(
        (choice: {
          choice: string;
          points: number;
          feedback: string;
          isCorrect: boolean;
        }) => ({
          choice: choice.choice,
          points: choice.points,
          feedback: choice.feedback,
          isCorrect: choice.isCorrect,
        }),
      );

      let learnerChoices: string[] | undefined;
      if (
        (question.type === "SINGLE_CORRECT" ||
          question.type === "MULTIPLE_CORRECT") &&
        correspondingResponses.length > 0
      ) {
        const learnerResponse = correspondingResponses[0]?.learnerResponse;
        if (learnerResponse && typeof learnerResponse === "string") {
          const parsed: unknown = JSON.parse(learnerResponse);
          if (Array.isArray(parsed)) {
            learnerChoices = parsed as string[];
          }
        }
      }

      return {
        id: question.id,
        variantId: extendedQuestion.variantId,
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        maxCharacters: question.maxCharacters,
        type: question.type,
        question: question.question,
        choices: formattedChoices,
        assignmentId: question.assignmentId,
        alreadyInBackend: true,
        questionResponses: correspondingResponses,
        responseType: question.responseType,
        scoring:
          typeof question.scoring === "string" &&
          (JSON.parse(question.scoring) as { showRubricsToLearner?: boolean })
            ?.showRubricsToLearner
            ? question.scoring
            : undefined,
        learnerChoices,
      };
    });
  }
  private parseChoices(choices: unknown): Choice[] {
    if (!choices) {
      return [];
    }
    if (typeof choices === "string") {
      return JSON.parse(choices) as Choice[];
    }
    return choices as Choice[];
  }
}
