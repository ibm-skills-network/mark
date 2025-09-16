/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable unicorn/no-null */
import { HttpService } from "@nestjs/axios";
import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import {
  AssignmentAttempt,
  AssignmentQuestionDisplayOrder,
  Question,
  QuestionType,
  QuestionVariant,
  ResponseType,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { GRADE_SUBMISSION_EXCEPTION } from "src/api/assignment/attempt/api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/base.assignment.attempt.response.dto";
import { LearnerUpdateAssignmentAttemptRequestDto } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentAttemptQuestions,
  GetAssignmentAttemptResponseDto,
} from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "src/api/assignment/attempt/dto/assignment-attempt/update.assignment.attempt.response.dto";
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
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { AssignmentRepository } from "src/api/assignment/v2/repositories/assignment.repository";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import {
  AssignmentAttemptWithRelations,
  AttemptQuestionsMapper,
  EnhancedAttemptQuestionDto,
} from "../common/utils/attempt-questions-mapper.util";
import { AttemptGradingService } from "./attempt-grading.service";
import { AttemptValidationService } from "./attempt-validation.service";
import { QuestionResponseService } from "./question-response/question-response.service";
import { QuestionVariantService } from "./question-variant/question-variant.service";
import { TranslationService } from "./translation/translation.service";

@Injectable()
export class AttemptSubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: AttemptValidationService,
    private readonly gradingService: AttemptGradingService,
    private assignmentRepository: AssignmentRepository,
    private readonly questionResponseService: QuestionResponseService,
    private readonly translationService: TranslationService,
    private readonly questionVariantService: QuestionVariantService,
    private readonly httpService: HttpService,
  ) {}
  /**
   * Creates a new assignment attempt
   */
  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    const assignment = await this.assignmentRepository.findById(
      assignmentId,
      userSession,
    );

    await this.validationService.validateNewAttempt(assignment, userSession);

    const attemptExpiresAt = this.calculateAttemptExpiresAt(assignment);

    // Get the assignment with its active version for version-aware attempt creation
    const assignmentWithActiveVersion = await this.prisma.assignment.findUnique(
      {
        where: { id: assignmentId },
        include: {
          currentVersion: {
            include: {
              questionVersions: true,
            },
          },
          // Fallback to legacy questions if no active version exists
          questions: {
            where: { isDeleted: false },
            include: {
              variants: {
                where: { isDeleted: false },
              },
            },
          },
        },
      },
    );

    if (!assignmentWithActiveVersion) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentId} not found.`,
      );
    }

    const activeVersionId = assignmentWithActiveVersion.currentVersionId;

    const assignmentAttempt = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId,
        assignmentVersionId: activeVersionId, // Store the active version ID
        grade: undefined,
        userId: userSession.userId,
        questionOrder: [],
      },
    });

    // Use questions from active version if available, otherwise fallback to legacy questions
    const questions: QuestionDto[] =
      assignmentWithActiveVersion?.currentVersion?.questionVersions?.length > 0
        ? assignmentWithActiveVersion.currentVersion.questionVersions.map(
            (qv) => ({
              id: qv.questionId || qv.id, // Use questionId if available, fallback to qv.id
              question: qv.question,
              type: qv.type,
              assignmentId: assignmentId, // Set from parameter since QuestionVersion doesn't have this
              totalPoints: qv.totalPoints,
              maxWords: qv.maxWords,
              maxCharacters: qv.maxCharacters,
              choices: qv.choices as unknown as Choice[],
              scoring: qv.scoring as unknown as ScoringDto,
              answer: qv.answer,
              variants: [], // QuestionVersions don't have variants, use empty array
              gradingContextQuestionIds: qv.gradingContextQuestionIds,
              responseType: qv.responseType,
              isDeleted: false, // QuestionVersions are not deleted by definition
              randomizedChoices: qv.randomizedChoices,
              videoPresentationConfig:
                qv.videoPresentationConfig as unknown as VideoPresentationConfig,
              liveRecordingConfig: qv.liveRecordingConfig as object,
            }),
          )
        : ((assignmentWithActiveVersion?.questions || []).map((q) => ({
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
          })) as QuestionDto[]);

    // match number of questions to the assignment settings numberOfQuestionsPerAttempt
    if (
      assignment.numberOfQuestionsPerAttempt &&
      assignment.numberOfQuestionsPerAttempt > 0
    ) {
      // pick random questions from the assignment
      const shuffledQuestions = questions.sort(() => Math.random() - 0.5);
      const selectedQuestions = shuffledQuestions.slice(
        0,
        assignment.numberOfQuestionsPerAttempt,
      );
      if (selectedQuestions.length < assignment.numberOfQuestionsPerAttempt) {
        throw new NotFoundException(
          `Not enough questions available for the assignment with Id ${assignmentId}.`,
        );
      }
      questions.length = 0; // clear the original questions array
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

    const orderedQuestions = this.getOrderedQuestions(questionDtos, assignment);

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

    // Use version-specific questions if available, otherwise fallback to legacy questions
    const questions: unknown[] =
      assignmentAttempt.assignmentVersionId &&
      assignmentAttempt.assignmentVersion?.questionVersions?.length > 0
        ? assignmentAttempt.assignmentVersion.questionVersions.map((qv) => ({
            id: qv.questionId || qv.id,
            question: qv.question,
            type: qv.type,
            assignmentId: assignmentAttempt.assignmentId,
            totalPoints: qv.totalPoints,
            maxWords: qv.maxWords,
            maxCharacters: qv.maxCharacters,
            choices: qv.choices,
            scoring: qv.scoring,
            answer: qv.answer,
            gradingContextQuestionIds: qv.gradingContextQuestionIds,
            responseType: qv.responseType,
            isDeleted: false,
            randomizedChoices: qv.randomizedChoices,
            videoPresentationConfig: qv.videoPresentationConfig,
            liveRecordingConfig: qv.liveRecordingConfig,
          }))
        : await this.prisma.question.findMany({
            where: { assignmentId: assignmentAttempt.assignmentId },
          });

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        showCorrectAnswer: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }

    const questionDtos: EnhancedAttemptQuestionDto[] = questions.map((q) => {
      const question = q as Record<string, unknown>;

      const answerValue =
        typeof question.answer === "boolean"
          ? String(question.answer)
          : question.answer !== null && question.answer !== undefined
            ? String(question.answer)
            : undefined;

      const randomizedChoicesValue: string =
        typeof question.randomizedChoices === "string"
          ? question.randomizedChoices
          : JSON.stringify(question.randomizedChoices ?? false);

      return {
        id: question.id as number,
        question: question.question as string,
        type: question.type as QuestionType,
        assignmentId: question.assignmentId as number,
        totalPoints: question.totalPoints as number,
        maxWords: (question.maxWords as number) || undefined,
        maxCharacters: (question.maxCharacters as number) || undefined,
        choices: this.parseJsonValue<Choice[]>(question.choices, []),
        scoring: this.parseJsonValue<ScoringDto>(question.scoring, {
          type: ScoringType.CRITERIA_BASED,
          showRubricsToLearner: false,
          rubrics: [],
        }),
        answer: answerValue,
        gradingContextQuestionIds:
          (question.gradingContextQuestionIds as number[]) || [],
        responseType: (question.responseType as ResponseType) || undefined,
        isDeleted: question.isDeleted as boolean,
        randomizedChoices: randomizedChoicesValue,
        videoPresentationConfig:
          this.parseJsonValue<VideoPresentationConfig | null>(
            question.videoPresentationConfig,
            null,
          ),
        liveRecordingConfig: this.parseJsonValue<Record<
          string,
          unknown
        > | null>(question.liveRecordingConfig, null),
      };
    });

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
        questionDtos,
        {
          id: assignmentAttempt.assignmentId,
          ...assignment,
        },
        this.prisma,
        assignmentAttempt.preferredLanguage || undefined,
      );

    this.applyVisibilitySettings(finalQuestions, assignmentAttempt, assignment);

    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestions: assignment.showQuestions,
      showQuestionScore: assignment.showQuestionScore,
      showCorrectAnswer: assignment.showCorrectAnswer,
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
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestions: true,
        showQuestionScore: true,
        showCorrectAnswer: true,
      },
    })) as {
      questions: Question[];
      questionOrder: number[];
      displayOrder: AssignmentQuestionDisplayOrder | null;
      passingGrade: number;
      showAssignmentScore: boolean;
      showSubmissionFeedback: boolean;
      showQuestions: boolean;
      showQuestionScore: boolean;
      showCorrectAnswer: boolean;
    };

    // Get version-specific questions for translation if available
    const questionsForTranslation: QuestionDto[] =
      assignmentAttempt.assignmentVersionId &&
      assignmentAttempt.assignmentVersion?.questionVersions?.length > 0
        ? (assignmentAttempt.assignmentVersion.questionVersions.map((qv) => ({
            id: qv.questionId || qv.id,
            question: qv.question,
            type: qv.type,
            assignmentId: assignmentAttempt.assignmentId,
            totalPoints: qv.totalPoints,
            maxWords: qv.maxWords,
            maxCharacters: qv.maxCharacters,
            choices: qv.choices as unknown as Choice[],
            scoring: qv.scoring as unknown as ScoringDto,
            answer: qv.answer,
            variants: [],
            gradingContextQuestionIds: qv.gradingContextQuestionIds,
            responseType: qv.responseType,
            isDeleted: false,
            randomizedChoices: qv.randomizedChoices,
            videoPresentationConfig:
              qv.videoPresentationConfig as unknown as VideoPresentationConfig,
            liveRecordingConfig: qv.liveRecordingConfig as object,
          })) as QuestionDto[])
        : (assignment.questions as unknown as QuestionDto[]);

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

    const finalQuestions: AttemptQuestionDto[] =
      await AttemptQuestionsMapper.buildQuestionsWithTranslations(
        formattedAttempt,
        assignment as unknown as UpdateAssignmentQuestionsDto,
        translations,
        normalizedLanguage,
      );

    this.removeSensitiveData(finalQuestions, assignment);

    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      showQuestions: assignment.showQuestions,
      showCorrectAnswer: assignment.showCorrectAnswer,
    };
  }

  /**
   * Updates an attempt for a learner
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
      // Report initial progress
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
        },
      });

      if (progressCallback) {
        await progressCallback("Processing question responses...", 20);
      }

      const successfulQuestionResponses =
        await this.questionResponseService.submitQuestions(
          updateDto.responsesForQuestions,
          attemptId,
          request.userSession.role,
          assignmentId,
          updateDto.language,
          updateDto.authorQuestions,
          updateDto.authorAssignmentDetails,
          updateDto.preTranslatedQuestions,
        );

      if (progressCallback) {
        await progressCallback("Calculating grades...", 70);
      }

      let totalPossiblePoints = 0;
      for (const response of successfulQuestionResponses) {
        const question = assignment.questions.find(
          (q) => q.id === response.questionId,
        );
        totalPossiblePoints += question?.totalPoints || 0;
      }

      const { grade, totalPointsEarned } =
        this.gradingService.calculateGradeForLearner(
          successfulQuestionResponses,
          totalPossiblePoints,
        );

      if (gradingCallbackRequired) {
        if (progressCallback) {
          await progressCallback("Sending grade to LTI...", 80);
        }
        await this.handleLtiGradeCallback(
          grade,
          authCookie,
          assignmentId,
          request.userSession.userId,
        );
      }

      if (progressCallback) {
        await progressCallback("Saving results...", 90);
      }

      const result = await this.updateAssignmentAttemptInDb(
        attemptId,
        updateDto,
        grade,
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
        showCorrectAnswer: assignment.showCorrectAnswer,
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
        await progressCallback("Processing author preview...", 10);
      }

      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          questions: {
            where: { isDeleted: false },
          },
        },
      });

      const fakeAttemptId = -1;

      if (progressCallback) {
        await progressCallback("Submitting questions...", 30);
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
        await progressCallback("Calculating grades...", 70);
      }

      let totalPossiblePoints = 0;
      for (const response of successfulQuestionResponses) {
        const question = assignment.questions.find(
          (q) => q.id === response.questionId,
        );
        totalPossiblePoints += question?.totalPoints || 0;
      }

      const { grade, totalPointsEarned } =
        this.gradingService.calculateGradeForAuthor(
          successfulQuestionResponses,
          totalPossiblePoints,
        );

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
        showCorrectAnswer: assignment.showCorrectAnswer,
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
      showCorrectAnswer: false,
    };
  }

  /**
   * Handle the LTI grade callback
   */
  private async handleLtiGradeCallback(
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

    await this.sendGradeToLtiGateway(highestOverall, authCookie);
  }

  /**
   * Update the assignment attempt in the database
   */
  private async updateAssignmentAttemptInDb(
    attemptId: number,
    updateDto: LearnerUpdateAssignmentAttemptRequestDto,
    grade: number,
  ) {
    const {
      responsesForQuestions,
      authorQuestions,
      authorAssignmentDetails,
      language,
      preTranslatedQuestions,
      ...cleanedUpdateDto
    } = updateDto;

    return this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateDto,
        preferredLanguage: language ?? "en",
        expiresAt: new Date(),
        grade,
      },
      where: { id: attemptId },
    });
  }

  /**
   * Send a grade to the LTI gateway
   */
  private async sendGradeToLtiGateway(
    grade: number,
    authCookie: string,
  ): Promise<void> {
    try {
      const ltiGatewayResponse = await this.httpService
        .put(
          process.env.GRADING_LTI_GATEWAY_URL,
          { score: grade },
          {
            headers: {
              Cookie: `authentication=${authCookie}`,
            },
          },
        )
        .toPromise();

      if (ltiGatewayResponse.status !== 200) {
        throw new InternalServerErrorException(GRADE_SUBMISSION_EXCEPTION);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unknown error occurred while sending the grade to the LTI gateway.";
      throw new InternalServerErrorException(
        `${GRADE_SUBMISSION_EXCEPTION}: ${errorMessage}`,
      );
    }
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
    return undefined;
  }

  /**
   * Get ordered questions based on assignment settings
   */
  private getOrderedQuestions(
    questions: QuestionDto[],
    assignment: GetAssignmentResponseDto | LearnerGetAssignmentResponseDto,
  ): QuestionDto[] {
    const orderedQuestions = [...questions];

    if (assignment.displayOrder === "RANDOM") {
      orderedQuestions.sort(() => Math.random() - 0.5);
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      orderedQuestions.sort(
        (a, b) =>
          assignment.questionOrder.indexOf(a.id) -
          assignment.questionOrder.indexOf(b.id),
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
    assignment: {
      showCorrectAnswer?: boolean;
    },
  ): void {
    for (const question of questions) {
      if (!question.scoring?.showRubricsToLearner) {
        delete question.scoring?.rubrics;
      }

      if (question.choices) {
        for (const choice of question.choices) {
          delete choice.points;
          if (assignment.showCorrectAnswer === false) {
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
              if (assignment.showCorrectAnswer === false) {
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
            if (assignment.showCorrectAnswer === false) {
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
}
