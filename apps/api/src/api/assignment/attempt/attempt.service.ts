/* eslint-disable unicorn/no-null */
import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  Assignment,
  CorrectAnswerVisibility,
  Question,
  QuestionType,
  QuestionVariant,
  RegradingStatus,
  ReportType,
  Translation,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { LearnerFileUpload } from "src/api/attempt/common/interfaces/attempt.interface";
import {
  SuccessPageDataDto,
  SuccessPageQuestionDto,
} from "src/api/attempt/dto/success-page-data.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { PresentationQuestionEvaluateModel } from "src/api/llm/model/presentation.question.evaluate.model";
import { VideoPresentationQuestionEvaluateModel } from "src/api/llm/model/video-presentation.question.evaluate.model";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { QuestionAnswerContext } from "../../llm/model/base.question.evaluate.model";
import { FileUploadQuestionEvaluateModel } from "../../llm/model/file.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { UrlBasedQuestionEvaluateModel } from "../../llm/model/url.based.question.evaluate.model";
import type { LearnerGetAssignmentResponseDto } from "../dto/get.assignment.response.dto";
import {
  AttemptQuestionDto,
  QuestionDto,
  ScoringDto,
} from "../dto/update.questions.request.dto";
import { Choice } from "../question/dto/create.update.question.request.dto";
import { QuestionService } from "../question/question.service";
import { AssignmentServiceV1 } from "../v1/services/assignment.service";
import {
  GRADE_SUBMISSION_EXCEPTION,
  IN_COOLDOWN_PERIOD,
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { BaseAssignmentAttemptResponseDto } from "./dto/assignment-attempt/base.assignment.attempt.response.dto";
import {
  authorAssignmentDetailsDTO,
  LearnerUpdateAssignmentAttemptRequestDto,
} from "./dto/assignment-attempt/create.update.assignment.attempt.request.dto";
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
import { LearnerPresentationResponse } from "./dto/assignment-attempt/types";
import { UpdateAssignmentAttemptResponseDto } from "./dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
} from "./dto/question-response/create.question.response.attempt.response.dto";
import type { GetQuestionResponseAttemptResponseDto } from "./dto/question-response/get.question.response.attempt.response.dto";
import { AttemptHelper } from "./helper/attempts.helper";

type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
  assignmentAttemptId?: number;
  learnerResponse?: string;
  points: number;
  feedback: object;
  gradedAt?: Date;
};
type ExtendedQuestion = Question & { variantId?: number };

@Injectable()
export class AttemptServiceV1 {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentServiceV1,
    private readonly httpService: HttpService,
  ) {}

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
        })
      : this.prisma.assignmentAttempt.findMany({
          where: { assignmentId, userId },
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

    if (assignment.displayOrder === "RANDOM") {
      questions.sort(() => Math.random() - 0.5);
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      questions.sort(
        (a, b) =>
          assignment.questionOrder.indexOf(a.id) -
          assignment.questionOrder.indexOf(b.id),
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
    };
  }

  /**
   * Processes assignment attempt submissions and calculates final grades.
   *
   * Handles:
   * - Learner attempt expiration validation
   * - Question response submission and scoring
   * - Role-based grade calculation (learner vs author)
   * - LTI grade callback integration
   * - Feedback generation
   *
   * @param assignmentAttemptId - ID of existing attempt to update
   * @param assignmentId - ID of parent assignment
   * @param updateAssignmentAttemptDto - Contains user responses and author test data
   * @param authCookie - LTI authentication token for grade callback
   * @param gradingCallbackRequired - Flag for LTI grade sync requirement
   * @param request - User session with role information
   * @returns Detailed attempt results with scoring and feedback
   *
   * @remarks
   * 1. Learner-specific validation:
   *    - Checks attempt expiration
   *    - Enforces submission deadlines
   *
   * 2. Response processing:
   *    - Validates and scores individual question responses
   *    - Maintains successful response tracking
   *
   * 3. Grade calculation:
   *    - Learner mode: Uses actual assignment rubrics
   *    - Author mode: Simulates scoring with test data
   *
   * 4. LTI integration:
   *    - Conditionally sends grades to external LMS
   *    - Only applies to learner submissions
   *
   * 5. Result handling:
   *    - Learners: Persists results to database
   *    - Authors: Returns simulated results without persistence
   *    - Constructs contextual feedback based on assignment settings
   *
   * @throws ForbiddenException For expired attempts or unauthorized access
   * @throws NotFoundException For invalid attempt/assignment IDs
   * @throws BadRequestException For malformed response data
   */
  async updateAssignmentAttempt(
    assignmentAttemptId: number,
    assignmentId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const { role, userId } = request.userSession;
    if (role === UserRole.LEARNER) {
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
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
      const tenSecondsBeforeNow = new Date(Date.now() - 10 * 1000);
      if (
        assignmentAttempt.expiresAt &&
        tenSecondsBeforeNow > assignmentAttempt.expiresAt
      ) {
        await this.prisma.assignmentAttempt.update({
          where: { id: assignmentAttemptId },
          data: {
            submitted: true,
            grade: 0,
            comments:
              "You submitted the assignment after the deadline. Your submission will not be graded. If you dont have any more attempts, please contact your instructor.",
          },
        });
        return {
          id: assignmentAttemptId,
          submitted: true,
          success: true,
          totalPointsEarned: 0,
          totalPossiblePoints: 0,
          grade: 0,
          showSubmissionFeedback: false,
          showQuestions: false,
          correctAnswerVisibility: "NEVER",
          feedbacksForQuestions: [],
          message: SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
        };
      }
      const preTranslatedQuestions = new Map<number, QuestionDto>();

      for (const response of updateAssignmentAttemptDto.responsesForQuestions) {
        const questionId: number = response.id;
        const variantMapping = assignmentAttempt.questionVariants.find(
          (qv) => qv.questionId === questionId,
        );
        let question: QuestionDto;
        if (variantMapping && variantMapping.questionVariant !== null) {
          // Build the question from variant details (logic from Response)
          const variant = variantMapping.questionVariant;
          const baseQuestion = variant.variantOf;
          question = {
            id: variantMapping.questionVariant.id,
            question: variant.variantContent,
            type: baseQuestion.type,
            assignmentId: baseQuestion.assignmentId,
            maxWords: variant.maxWords ?? baseQuestion.maxWords,
            maxCharacters: variant.maxCharacters ?? baseQuestion.maxCharacters,
            scoring:
              typeof variant.scoring === "string"
                ? (JSON.parse(variant.scoring) as ScoringDto)
                : ((variant.scoring as unknown as ScoringDto) ??
                  (typeof baseQuestion.scoring === "string"
                    ? (JSON.parse(baseQuestion.scoring) as ScoringDto)
                    : (baseQuestion.scoring as unknown as ScoringDto))),
            choices:
              typeof variant.choices === "string"
                ? (JSON.parse(variant.choices) as Choice[])
                : ((variant.choices as unknown as Choice[]) ??
                  (typeof baseQuestion.choices === "string"
                    ? (JSON.parse(baseQuestion.choices) as Choice[])
                    : (baseQuestion.choices as unknown as Choice[]))),
            answer: baseQuestion.answer ?? variant.answer,
            alreadyInBackend: true,
            totalPoints: baseQuestion.totalPoints,
            gradingContextQuestionIds:
              baseQuestion.gradingContextQuestionIds ?? [],
          };
        } else {
          question = await this.questionService.findOne(questionId);
        }

        question = await this.applyTranslationToQuestion(
          question,
          updateAssignmentAttemptDto.language,
          variantMapping,
        );
        preTranslatedQuestions.set(questionId, question);
      }

      updateAssignmentAttemptDto.preTranslatedQuestions =
        preTranslatedQuestions;
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        showQuestions: true,
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
        questions: {
          where: { isDeleted: false },
        },
      },
    });
    const successfulQuestionResponses = await this.submitQuestions(
      updateAssignmentAttemptDto.responsesForQuestions as unknown as QuestionResponse[],
      assignmentAttemptId,
      role,
      assignmentId,
      updateAssignmentAttemptDto.language,
      updateAssignmentAttemptDto.authorQuestions,
      updateAssignmentAttemptDto.authorAssignmentDetails,
      updateAssignmentAttemptDto.preTranslatedQuestions,
    );
    const { grade, totalPointsEarned, totalPossiblePoints } =
      role === UserRole.LEARNER
        ? this.calculateGradeForLearner(
            successfulQuestionResponses,
            assignment as unknown as GetAssignmentAttemptResponseDto,
          )
        : this.calculateGradeForAuthor(
            successfulQuestionResponses,
            updateAssignmentAttemptDto.authorQuestions,
          );

    if (gradingCallbackRequired && role === UserRole.LEARNER) {
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
    if (role === UserRole.AUTHOR) {
      return {
        id: -1,
        submitted: true,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        grade: assignment.showAssignmentScore ? grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        showQuestions: assignment.showQuestions,
        correctAnswerVisibility:
          assignment.currentVersion?.correctAnswerVisibility || "NEVER",
        feedbacksForQuestions: this.constructFeedbacksForQuestions(
          successfulQuestionResponses,
          assignment as unknown as LearnerGetAssignmentResponseDto,
        ),
      };
    } else {
      const result = await this.updateAssignmentAttemptInDb(
        assignmentAttemptId,
        updateAssignmentAttemptDto,
        grade,
      );
      return {
        id: result.id,
        submitted: result.submitted,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        showQuestions: assignment.showQuestions,
        grade: assignment.showAssignmentScore ? result.grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        correctAnswerVisibility:
          assignment.currentVersion?.correctAnswerVisibility || "NEVER",
        feedbacksForQuestions: this.constructFeedbacksForQuestions(
          successfulQuestionResponses,
          assignment as unknown as LearnerGetAssignmentResponseDto,
        ),
      };
    }
  }
  /**
   * Retrieves and formats a learner's assignment attempt that is completed
   *
   * Handles:
   * - Attempt metadata retrieval
   * - Question/variant data merging
   * - Response mapping
   * - Display settings enforcement
   * - Secure data exposure based on assignment configuration
   *
   * @param assignmentAttemptId - ID of existing attempt to retrieve
   * @returns Structured attempt data with questions, responses, and display-configured scoring
   *
   * @remarks
   * 1. Data Aggregation:
   *    - Combines base question data with variant overrides
   *    - Preserves original question order from attempt creation
   *    - Merges stored responses with question definitions
   *
   * 2. Display Configuration:
   *    - Respects assignment-level visibility settings for:
   *      - Overall grades (showAssignmentScore)
   *      - Per-question feedback (showSubmissionFeedback)
   *      - Per-question scores (showQuestionScore)
   *    - Maintains question order from attempt creation
   *    - Formats choices as parsed JSON when needed
   *
   * 3. Security Considerations:
   *    - Ensures sensitive data (answers, full scores) is only exposed per settings
   *    - Filters deleted questions from results
   *    - Validates existence of all related database entities
   *
   * 4. Data Transformation:
   *    - Normalizes choice data from stringified JSON
   *    - Applies variant content overrides where present
   *    - Maps scoring rules from either variant or original question
   *
   * @throws NotFoundException If attempt, questions, or assignment cannot be found
   * @throws BadRequestException If stored data formats are invalid
   */
  async getLearnerAssignmentAttempt(
    assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: { questionVariant: { include: { variantOf: true } } },
        },
      },
    });
    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
      );
    }

    const questions = await this.prisma.question.findMany({
      where: { assignmentId: assignmentAttempt.assignmentId },
    });
    if (!questions) {
      throw new NotFoundException(
        `Questions for assignment with Id ${assignmentAttempt.assignmentId} not found.`,
      );
    }

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
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
      },
    });

    let questionOrder: number[] = [];
    if (assignmentAttempt.questionOrder?.length) {
      questionOrder = assignmentAttempt.questionOrder;
    } else if (assignment.questionOrder?.length) {
      questionOrder = assignment.questionOrder;
    } else {
      questionOrder = questions.map((q) => q.id);
    }
    const questionById = new Map(questions.map((q) => [q.id, q]));

    const questionVariantsArray = assignmentAttempt.questionVariants ?? [];
    const questionsWithVariants = questionVariantsArray.map((qv) => {
      const variant = qv.questionVariant;
      const originalQ = questionById.get(qv.questionId);
      const questionText = variant?.variantContent ?? originalQ?.question;
      const scoring = variant?.scoring ?? originalQ?.scoring;
      const maxWords = variant?.maxWords ?? originalQ?.maxWords;
      const maxChars = variant?.maxCharacters ?? originalQ?.maxCharacters;
      let finalChoices: Choice[] = qv.randomizedChoices
        ? (JSON.parse(qv.randomizedChoices as string) as Choice[])
        : ((variant?.choices ?? originalQ?.choices) as unknown as Choice[]);
      if (typeof finalChoices === "string") {
        finalChoices = JSON.parse(finalChoices) as Choice[];
      }
      return {
        id: originalQ.id,
        variantId: variant ? variant.id : undefined,
        question: questionText,
        choices: finalChoices,
        maxWords,
        maxCharacters: maxChars,
        scoring,
        totalPoints: originalQ.totalPoints,
        answer: originalQ.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ?.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: originalQ.randomizedChoices,
        videoPresentationConfig:
          originalQ.videoPresentationConfig as unknown as JSON,
        liveRecordingConfig: originalQ.liveRecordingConfig as unknown as JSON,
      };
    });

    const questionVariantsMap = new Map(
      questionsWithVariants.map((question) => [question.id, question]),
    );
    const mergedQuestions = questions.map((originalQ) => {
      const variantQ = questionVariantsMap.get(originalQ.id);
      if (variantQ) {
        return variantQ;
      }
      return { ...originalQ, variantId: undefined };
    });

    const questionsWithResponses = this.constructQuestionsWithResponses(
      mergedQuestions.map((question) => ({
        ...question,
        choices: JSON.stringify(question.choices) as unknown as JsonValue,
        scoring: JSON.stringify(question.scoring) as unknown as JsonValue,
        videoPresentationConfig:
          (question.videoPresentationConfig as unknown as JsonValue) ??
          undefined,
        liveRecordingConfig:
          (question.liveRecordingConfig as unknown as JsonValue) ?? undefined,
      })),
      assignmentAttempt.questionResponses as unknown as QuestionResponse[],
    );
    const finalQuestions = questionOrder
      .map((qId) => questionsWithResponses.find((q) => q.id === qId))
      .filter(Boolean);

    if (assignment.showAssignmentScore === false) {
      delete assignmentAttempt.grade;
    }
    if (assignment.showSubmissionFeedback === false) {
      for (const q of finalQuestions) {
        if (q.questionResponses[0]?.feedback) {
          delete q.questionResponses[0].feedback;
        }
      }
    }
    if (assignment.showQuestionScore === false) {
      for (const q of finalQuestions) {
        if (q.questionResponses[0]?.points !== undefined) {
          q.questionResponses[0].points = -1;
        }
      }
    }

    if (
      assignmentAttempt.preferredLanguage &&
      assignmentAttempt.preferredLanguage !== "en"
    ) {
      for (const question of finalQuestions) {
        const translation = await (question.variantId
          ? this.prisma.translation.findFirst({
              where: {
                questionId: question.id,
                variantId: question.variantId,
                languageCode: assignmentAttempt.preferredLanguage,
              },
            })
          : this.prisma.translation.findFirst({
              where: {
                questionId: question.id,
                variantId: null,
                languageCode: assignmentAttempt.preferredLanguage,
              },
            }));
        if (translation) {
          question.question = translation.translatedText;
          if (
            translation.translatedChoices !== undefined &&
            translation.translatedChoices !== null
          ) {
            question.choices =
              typeof translation.translatedChoices === "string"
                ? (JSON.parse(translation.translatedChoices) as Choice[])
                : (translation.translatedChoices as unknown as Choice[]);
          }
        }
      }
    }

    // Apply visibility settings for correct answers and if learner didnt pass
    if (
      (assignment.currentVersion?.correctAnswerVisibility || "NEVER") ===
        "NEVER" &&
      assignmentAttempt.grade < assignment.passingGrade
    ) {
      for (const question of finalQuestions) {
        if (question.choices) {
          for (const choice of question.choices) {
            delete choice.isCorrect;
            delete choice.feedback;
          }
        }
      }
    }

    return {
      ...assignmentAttempt,
      questions: finalQuestions.map((question) => ({
        ...question,
        choices:
          typeof question.choices === "string"
            ? (JSON.parse(question.choices) as Choice[])
            : question.choices,
      })),
      showQuestions: assignment.showQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
      correctAnswerVisibility:
        assignment.currentVersion?.correctAnswerVisibility || "NEVER",
      comments: assignmentAttempt.comments,
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
   * - Merged question/variant data including translations for all available languages
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

    const assignment = (await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
      select: {
        questions: true,
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
        currentVersion: {
          select: {
            correctAnswerVisibility: true,
          },
        },
      },
    })) as LearnerGetAssignmentResponseDto;

    const questionOrder =
      assignmentAttempt.questionOrder || assignment.questionOrder || [];

    const questionById = new Map(assignment.questions.map((q) => [q.id, q]));

    const questionIds = assignment.questions.map((q) => q.id);
    const variantIds = assignmentAttempt.questionVariants
      .map((qv) => qv.questionVariant?.id)
      .filter((id) => id != undefined);

    const translations = await this.prisma.translation.findMany({
      where: {
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
          } catch {
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
            (assignment.currentVersion?.correctAnswerVisibility || "NEVER") ===
              "ON_PASS" &&
            assignmentAttempt.grade < assignment.passingGrade
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
                (assignment.currentVersion?.correctAnswerVisibility ||
                  "NEVER") === "ON_PASS" &&
                assignmentAttempt.grade < assignment.passingGrade
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
            (assignment.currentVersion?.correctAnswerVisibility || "NEVER") ===
              "ON_PASS" &&
            assignmentAttempt.grade < assignment.passingGrade
          ) {
            delete choice.isCorrect;
            delete choice.feedback;
          }
        }
        question.randomizedChoices = JSON.stringify(randomizedArray);
      }

      if (
        (assignment.currentVersion?.correctAnswerVisibility || "NEVER") ===
          "ON_PASS" &&
        assignmentAttempt.grade < assignment.passingGrade
      ) {
        delete question.answer;
      }
    }

    return {
      ...assignmentAttempt,
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
      correctAnswerVisibility:
        assignment.currentVersion?.correctAnswerVisibility || "NEVER",
    };
  }

  /**
   * Handles the creation of a learner's or author's response to a question within an assignment attempt.
   *
   * @param {number} assignmentAttemptId - The unique identifier of the assignment attempt.
   * @param {number} questionId - The unique identifier of the question being answered.
   * @param {CreateQuestionResponseAttemptRequestDto} createQuestionResponseAttemptRequestDto - The data transfer object containing the user's response.
   * @param {UserRole} role - The role of the user (LEARNER or AUTHOR).
   * @param {number} assignmentId - The unique identifier of the assignment.
   * @param {QuestionDto[]} [authorQuestions] - (Optional) The list of questions when the user is an AUTHOR.
   * @param {authorAssignmentDetailsDTO} [assignmentDetails] - (Optional) Additional assignment details for an AUTHOR.
   *
   * @returns {Promise<CreateQuestionResponseAttemptResponseDto>} - A promise that resolves with the response DTO after processing the question response.
   *
   * @throws {NotFoundException} - If the assignment attempt does not exist (for learners).
   *
   * @description
   * This function processes a user's response to a question within an assignment attempt.
   * The behavior differs based on the user's role:
   *
   * - **For LEARNERS**:
   *   - The function fetches the assignment attempt and includes question variants.
   *   - If the question has a variant, it retrieves the corresponding variant details.
   *   - Otherwise, it fetches the original question from the `questionService`.
   *   - The function retrieves the assignment context based on the assignment and question.
   *
   * - **For AUTHORS**:
   *   - The function finds the question within the `authorQuestions` list.
   *   - It sets the assignment context using the `assignmentDetails`.
   *
   * After determining the question and assignment context, the function:
   * 1. Calls `processQuestionResponse` to evaluate the response.
   * 2. Stores the response in the database (`prisma.questionResponse.create`).
   * 3. Populates the response DTO with relevant information (ID, question content, points, and feedback).
   * 4. Returns the final response DTO.
   */
  async createQuestionResponse(
    assignmentAttemptId: number,
    questionId: number,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    role: UserRole,
    assignmentId: number,
    language: string,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
    preTranslatedQuestions?: Map<number, QuestionDto>,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let question: QuestionDto;
    let assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
    if (role === UserRole.LEARNER) {
      if (preTranslatedQuestions && preTranslatedQuestions.has(questionId)) {
        question = preTranslatedQuestions.get(questionId);
      } else {
        const assignmentAttempt =
          await this.prisma.assignmentAttempt.findUnique({
            where: { id: assignmentAttemptId },
            include: {
              questionVariants: {
                select: {
                  questionId: true,
                  questionVariant: {
                    include: { variantOf: true },
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
        const variantMapping = assignmentAttempt.questionVariants.find(
          (qv) => qv.questionId === questionId,
        );
        if (
          variantMapping &&
          variantMapping.questionVariant !== null &&
          variantMapping.questionVariant
        ) {
          const variant = variantMapping.questionVariant;
          const baseQuestion = variant.variantOf;
          question = {
            id: variantMapping.questionVariant.id,
            question: variant.variantContent,
            type: baseQuestion.type,
            assignmentId: baseQuestion.assignmentId,
            gradingContextQuestionIds:
              baseQuestion.gradingContextQuestionIds ?? [],
            maxWords: variant.maxWords ?? baseQuestion.maxWords,
            maxCharacters: variant.maxCharacters ?? baseQuestion.maxCharacters,
            scoring:
              typeof variant.scoring === "string"
                ? (JSON.parse(variant.scoring) as ScoringDto)
                : ((variant.scoring as unknown as ScoringDto) ??
                  (typeof baseQuestion.scoring === "string"
                    ? (JSON.parse(baseQuestion.scoring) as ScoringDto)
                    : (baseQuestion.scoring as unknown as ScoringDto))),
            choices:
              typeof variant.choices === "string"
                ? (JSON.parse(variant.choices) as Choice[])
                : ((variant.choices as unknown as Choice[]) ??
                  (typeof baseQuestion.choices === "string"
                    ? (JSON.parse(baseQuestion.choices) as Choice[])
                    : (baseQuestion.choices as unknown as Choice[]))),
            answer: baseQuestion.answer ?? variant.answer,
            alreadyInBackend: true,
            totalPoints: baseQuestion.totalPoints,
          };
        } else {
          question = await this.questionService.findOne(questionId);
        }
      }
      assignmentContext = await this.getAssignmentContext(
        assignmentId,
        questionId,
        assignmentAttemptId,
        role,
      );
    } else if (role === UserRole.AUTHOR) {
      question = authorQuestions.find((q) => q.id === questionId);
      assignmentContext = {
        assignmentInstructions: assignmentDetails?.instructions ?? "",
        questionAnswerContext: [],
      };
    }
    const { responseDto, learnerResponse } = await this.processQuestionResponse(
      question,
      createQuestionResponseAttemptRequestDto,
      assignmentContext,
      assignmentId,
      language,
    );
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentAttemptId:
          role === UserRole.LEARNER ? assignmentAttemptId : 1,
        questionId: questionId,
        learnerResponse: JSON.stringify(learnerResponse ?? ""),
        points: responseDto.totalPoints,
        feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      },
    });
    responseDto.id = result.id;
    responseDto.questionId = questionId;
    responseDto.question = question.question;
    return responseDto;
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

    const assignmentAttemptExists =
      await this.prisma.assignmentAttempt.findUnique({
        where: { id: attemptId },
      });
    if (!assignmentAttemptExists) {
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
   * Validates whether a new attempt can be created for the given assignment and user session.
   * @param assignment The assignment object.
   * @param userSession The user session.
   */
  private async validateNewAttempt(
    assignment: LearnerGetAssignmentResponseDto,
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
    const ongoingAttempts = attempts.filter(
      (sub) => !sub.submitted && (!sub.expiresAt || sub.expiresAt >= now),
    );
    if (ongoingAttempts.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }
    const attemptsInTimeRange = attempts.filter(
      (sub) => sub.createdAt >= timeRangeStartDate && sub.createdAt <= now,
    );

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      );
    }
    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const totalAttempts = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (totalAttempts >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
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
    assignment: LearnerGetAssignmentResponseDto,
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
      } catch {
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
   * Submits the questions for the assignment attempt.
   * @param responsesForQuestions The responses for questions.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @returns A list of successful question response attempt response DTOs.
   */
  private async submitQuestions(
    responsesForQuestions: QuestionResponse[],
    assignmentAttemptId: number,
    role: UserRole,
    assignmentId: number,
    language: string,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
    preTranslatedQuestions?: Map<number, QuestionDto>,
  ): Promise<CreateQuestionResponseAttemptResponseDto[]> {
    const questionResponsesPromise = responsesForQuestions.map(
      async (questionResponse) => {
        const { id: questionId, ...cleanedQuestionResponse } = questionResponse;
        return await this.createQuestionResponse(
          assignmentAttemptId,
          questionId,
          { ...cleanedQuestionResponse, id: questionId },
          role,
          assignmentId,
          language,
          authorQuestions,
          assignmentDetails,
          preTranslatedQuestions,
        );
      },
    );

    const questionResponses = await Promise.allSettled(
      questionResponsesPromise,
    );
    const successfulResponses = questionResponses
      .filter((response) => response.status === "fulfilled")
      .map((response) => response.value);

    const failedResponses = questionResponses
      .filter((response) => response.status === "rejected")
      .map((response) => response.reason as string);

    if (failedResponses.length > 0) {
      throw new InternalServerErrorException(
        `Failed to submit questions: ${failedResponses.join(", ")}`,
      );
    }

    return successfulResponses;
  }

  /**
   * Calculates the grade based on the question responses and assignment settings if the role is author.
   * @param successfulQuestionResponses
   * @param authorQuestions
   * @returns
   */
  private calculateGradeForAuthor(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    authorQuestions: QuestionDto[],
  ): { grade: number; totalPointsEarned: number; totalPossiblePoints: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0, totalPossiblePoints: 0 };
    }
    const totalPointsEarned = successfulQuestionResponses.reduce(
      (accumulator, response) => accumulator + response.totalPoints,
      0,
    );

    const totalPossiblePoints = authorQuestions.reduce(
      (accumulator: number, question: QuestionDto) =>
        accumulator + question.totalPoints,
      0,
    );

    const grade = totalPointsEarned / totalPossiblePoints;
    return { grade, totalPointsEarned, totalPossiblePoints };
  }

  /**
   * Calculates the grade based on the question responses and assignment settings if the role is learner.
   * @param successfulQuestionResponses The successful question responses.
   * @param assignment The assignment object.
   * @returns The calculated grade.
   */
  private calculateGradeForLearner(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    assignment: GetAssignmentAttemptResponseDto,
  ): { grade: number; totalPointsEarned: number; totalPossiblePoints: number } {
    if (successfulQuestionResponses.length === 0) {
      return { grade: 0, totalPointsEarned: 0, totalPossiblePoints: 0 };
    }
    const totalPointsEarned = successfulQuestionResponses.reduce(
      (accumulator, response) => accumulator + response.totalPoints,
      0,
    );

    const totalPossiblePoints = assignment.questions.reduce(
      (accumulator: number, question: { totalPoints: number }) =>
        accumulator + question.totalPoints,
      0,
    );

    const grade = totalPointsEarned / totalPossiblePoints;
    return { grade, totalPointsEarned, totalPossiblePoints };
  }

  /**
   * Sends the grade to the LTI gateway if required.
   * @param grade The calculated grade.
   * @param authCookie The authentication cookie.
   */
  private async sendGradeToLtiGateway(
    grade: number,
    authCookie: string,
  ): Promise<void> {
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
  }

  /**
   * Updates the assignment attempt in the database with the new grade.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param updateAssignmentAttemptDto The update request DTO.
   * @param grade The calculated grade.
   * @returns The updated assignment attempt.
   */
  private async updateAssignmentAttemptInDb(
    assignmentAttemptId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    grade: number,
  ) {
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      responsesForQuestions,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      authorQuestions,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      authorAssignmentDetails,
      language,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      preTranslatedQuestions,
      ...cleanedUpdateAssignmentAttemptDto
    } = updateAssignmentAttemptDto;

    return this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateAssignmentAttemptDto,
        preferredLanguage: language ?? "en",
        expiresAt: new Date(),
        grade,
      },
      where: { id: assignmentAttemptId },
    });
  }

  /**
   * Constructs feedbacks for questions based on the assignment settings.
   * @param successfulQuestionResponses The successful question responses.
   * @param assignment The assignment object.
   * @returns An array of feedbacks for questions.
   */
  private constructFeedbacksForQuestions(
    successfulQuestionResponses: CreateQuestionResponseAttemptResponseDto[],
    assignment: LearnerGetAssignmentResponseDto,
  ) {
    return successfulQuestionResponses.map((feedbackForQuestion) => {
      const { totalPoints, feedback, ...otherData } = feedbackForQuestion;
      return {
        totalPoints: assignment.showQuestionScore ? totalPoints : -1,
        feedback: assignment.showSubmissionFeedback ? feedback : undefined,
        ...otherData,
      };
    });
  }

  /**
   * Checks whether the submission deadline has passed.
   * @param expiresAt The expiration date of the assignment attempt.
   */
  private checkSubmissionDeadline(expiresAt: Date | null | undefined): void {
    const thirtySecondsBeforeNow = new Date(Date.now() - 30 * 1000);
    if (expiresAt && thirtySecondsBeforeNow > expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
  }

  /**
   * Processes the question response based on the question type.
   * @param question The question object.
   * @param createQuestionResponseAttemptRequestDto The create request DTO.
   * @param assignmentContext The assignment context.
   * @returns An object containing the response DTO and learner response.
   */
  private async processQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
    language: string,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse:
      | string
      | { filename: string; content: string }[]
      | LearnerPresentationResponse;
  }> {
    if (
      Array.isArray(
        createQuestionResponseAttemptRequestDto.learnerFileResponse,
      ) &&
      createQuestionResponseAttemptRequestDto.learnerFileResponse.length ===
        0 &&
      createQuestionResponseAttemptRequestDto.learnerUrlResponse.trim() ===
        "" &&
      createQuestionResponseAttemptRequestDto.learnerTextResponse.trim() ===
        "" &&
      Array.isArray(createQuestionResponseAttemptRequestDto.learnerChoices) &&
      createQuestionResponseAttemptRequestDto.learnerChoices.length === 0 &&
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null &&
      (createQuestionResponseAttemptRequestDto.learnerPresentationResponse ===
        undefined ||
        (Array.isArray(
          createQuestionResponseAttemptRequestDto.learnerPresentationResponse,
        ) &&
          createQuestionResponseAttemptRequestDto.learnerPresentationResponse
            .length === 0))
    ) {
      const responseDto = new CreateQuestionResponseAttemptResponseDto();
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          feedback: this.getLocalizedString("noResponse", language),
        },
      ];
      return { responseDto, learnerResponse: "" };
    }

    switch (question.type) {
      case QuestionType.TEXT: {
        return this.handleTextUploadQuestionResponse(
          question,
          question.type,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
          assignmentId,
          language,
        );
      }
      case QuestionType.LINK_FILE: {
        if (createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
          return this.handleUrlQuestionResponse(
            question,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            assignmentId,
            language,
          );
        } else if (
          createQuestionResponseAttemptRequestDto.learnerFileResponse
        ) {
          return this.handleFileUploadQuestionResponse(
            question,
            question.type,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            language,
          );
        } else {
          throw new BadRequestException(
            "Expected a file-based response (learnerFileResponse) or URL-based response (learnerUrlResponse), but did not receive one.",
          );
        }
      }
      case QuestionType.UPLOAD: {
        if (question.responseType === "LIVE_RECORDING") {
          return this.handlePresentationQuestionResponse(
            question,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            assignmentId,
          );
        } else if (question.responseType === "PRESENTATION") {
          return this.handleVideoPresentationQuestionResponse(
            question,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            assignmentId,
          );
        } else {
          return this.handleFileUploadQuestionResponse(
            question,
            question.type,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
          );
        }
      }
      case QuestionType.URL: {
        return this.handleUrlQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
          assignmentId,
          language,
        );
      }
      case QuestionType.TRUE_FALSE: {
        return this.handleTrueFalseQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          language,
        );
      }
      case QuestionType.SINGLE_CORRECT: {
        return this.handleSingleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          language,
        );
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return this.handleMultipleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          language,
        );
      }
      default: {
        throw new Error("Invalid question type provided.");
      }
    }
  }

  private async handlePresentationQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerPresentationResponse;
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerPresentationResponse) {
      throw new BadRequestException(
        "Expected a presentation-based response (learnerPresentationResponse), but did not receive one.",
      );
    }

    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerPresentationResponse;
    const presentationQuestionEvaluateModel =
      new PresentationQuestionEvaluateModel(
        question.question,
        assignmentContext.questionAnswerContext,
        assignmentContext?.assignmentInstructions,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring,
        question.type,
        question.responseType ?? "OTHER",
      );

    const model = await this.llmFacadeService.gradePresentationQuestion(
      presentationQuestionEvaluateModel,
      assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }
  private async handleVideoPresentationQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerPresentationResponse;
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerPresentationResponse) {
      throw new BadRequestException(
        "Expected a presentation-based response (learnerPresentationResponse), but did not receive one.",
      );
    }

    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerPresentationResponse;
    const videoPresentationQuestionEvaluateModel =
      new VideoPresentationQuestionEvaluateModel(
        question.question,
        assignmentContext.questionAnswerContext,
        assignmentContext?.assignmentInstructions,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring,
        question.type,
        question.responseType ?? "OTHER",
        question.videoPresentationConfig,
      );

    const model = await this.llmFacadeService.gradeVideoPresentationQuestion(
      videoPresentationQuestionEvaluateModel,
      assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  private async handleFileUploadQuestionResponse(
    question: QuestionDto,
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    language?: string,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: LearnerFileUpload[];
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerFileResponse) {
      throw new BadRequestException(
        "Expected a file-based response (learnerFileResponse), but did not receive one.",
      );
    }
    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerFileResponse;
    const fileUploadQuestionEvaluateModel = new FileUploadQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext?.assignmentInstructions,
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      questionType,
      question.responseType ?? "OTHER",
    );
    const model = await this.llmFacadeService.gradeFileBasedQuestion(
      fileUploadQuestionEvaluateModel,
      question.assignmentId,
      language,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles text and upload question responses.
   */
  private async handleTextUploadQuestionResponse(
    question: QuestionDto,
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
    language?: string,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  }> {
    const learnerResponse = await AttemptHelper.validateAndGetTextResponse(
      questionType,
      createQuestionResponseAttemptRequestDto,
    );

    const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext?.assignmentInstructions,
      learnerResponse,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.responseType ?? "OTHER",
    );

    const model = await this.llmFacadeService.gradeTextBasedQuestion(
      textBasedQuestionEvaluateModel,
      assignmentId,
      language,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles URL question responses.
   */
  private async handleUrlQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
    assignmentId: number,
    language?: string,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  }> {
    if (!createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
      throw new BadRequestException(
        "Expected a URL-based response (learnerUrlResponse), but did not receive one.",
      );
    }

    const learnerResponse =
      createQuestionResponseAttemptRequestDto.learnerUrlResponse;

    const urlFetchResponse =
      await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
    if (!urlFetchResponse.isFunctional) {
      throw new BadRequestException(
        `Unable to extract content from the provided URL: ${learnerResponse}`,
      );
    }

    const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext.assignmentInstructions,
      learnerResponse,
      urlFetchResponse.isFunctional,
      JSON.stringify(urlFetchResponse.body),
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.responseType ?? "OTHER",
    );

    const model = await this.llmFacadeService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
      assignmentId,
      language,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }
  private getSafeChoices(
    choices: Choice[] | string | null | undefined,
  ): string | null {
    if (!choices) return;
    return typeof choices === "string" ? choices : JSON.stringify(choices);
  }
  /**
   * Handles true/false question responses.
   */
  private handleTrueFalseQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    language: string,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    if (
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null ||
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === undefined
    ) {
      throw new BadRequestException(
        this.getLocalizedString("expectedTrueFalse", language),
      );
    }
    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice;
    if (learnerChoice === null) {
      throw new BadRequestException(
        this.getLocalizedString("invalidTrueFalse", language),
      );
    }
    const correctAnswer = question.choices[0].isCorrect;
    const isCorrect = learnerChoice === correctAnswer;
    const feedback = isCorrect
      ? this.getLocalizedString("correctTF", language)
      : this.getLocalizedString("incorrectTF", language, {
          correctAnswer: correctAnswer
            ? this.getLocalizedString("true", language)
            : this.getLocalizedString("false", language),
        });
    const correctPoints =
      question.choices && question.choices[0]
        ? question.choices[0].points || 0
        : 0;
    const pointsAwarded = isCorrect ? correctPoints : 0;

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = pointsAwarded;
    responseDto.feedback = [
      {
        feedback,
        choice: learnerChoice,
      },
    ];
    return { responseDto, learnerResponse: String(learnerChoice) };
  }
  private async applyTranslationToQuestion(
    question: QuestionDto,
    language: string,
    variantMapping?: { questionId: number; questionVariant: QuestionVariant },
  ): Promise<QuestionDto> {
    if (!language || language === "en") return question;

    let translation: Translation | null = null;

    if (
      variantMapping &&
      variantMapping.questionVariant !== null &&
      variantMapping.questionVariant
    ) {
      translation = await this.prisma.translation.findFirst({
        where: {
          questionId: variantMapping.questionId,
          variantId: variantMapping.questionVariant.id,
          languageCode: language,
        },
      });

      if (!translation) {
        translation = await this.prisma.translation.findFirst({
          where: {
            questionId: question.id,
            variantId: null,
            languageCode: language,
          },
        });
      }
    } else {
      translation = await this.prisma.translation.findFirst({
        where: {
          questionId: question.id,
          variantId: null,
          languageCode: language,
        },
      });
    }
    if (translation) {
      question.question = translation.translatedText;
      if (translation.translatedChoices) {
        if (typeof translation.translatedChoices === "string") {
          try {
            question.choices = JSON.parse(
              translation.translatedChoices,
            ) as Choice[];
          } catch {
            question.choices = [];
          }
        } else if (Array.isArray(translation.translatedChoices)) {
          question.choices =
            translation.translatedChoices as unknown as Choice[];
        }
      }
    }
    return question;
  }

  /**
   * Formats the feedback string by replacing placeholders with actual values.
   */
  private formatFeedback(
    feedbackTemplate: string,
    data: { [key: string]: unknown },
  ): string {
    return feedbackTemplate.replaceAll(
      /\${(.*?)}/g,
      (_, g: string) => (data[g] as string) || "",
    );
  }
  /**
   * Handles single correct question responses with custom feedbacks in Markdown format.
   */
  private handleSingleCorrectQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    language: string,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const choices = this.parseChoices(question.choices);
    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerChoices[0];

    const normalizedLearnerChoice = this.normalizeText(learnerChoice);
    const correctChoice = choices.find((choice) => choice.isCorrect);

    const selectedChoice = choices.find(
      (choice) => this.normalizeText(choice.choice) === normalizedLearnerChoice,
    );

    const data = {
      learnerChoice,
      correctChoice: correctChoice?.choice,
      points: selectedChoice ? selectedChoice.points : 0,
    };

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    if (selectedChoice) {
      let choiceFeedback = "";
      if (selectedChoice.feedback) {
        choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
      } else {
        choiceFeedback = selectedChoice.isCorrect
          ? this.getLocalizedString("correctSelection", language, data)
          : this.getLocalizedString("incorrectSelection", language, data);
      }
      responseDto.totalPoints = selectedChoice.isCorrect
        ? selectedChoice.points
        : 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: choiceFeedback,
        },
      ] as ChoiceBasedFeedbackDto[];
    } else {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: this.getLocalizedString("invalidSelection", language, {
            learnerChoice,
          }),
        },
      ] as ChoiceBasedFeedbackDto[];
    }

    const learnerResponse = JSON.stringify([learnerChoice]);
    return { responseDto, learnerResponse };
  }

  /**
   * Handles multiple correct question responses with custom feedbacks in Markdown format.
   */
  private handleMultipleCorrectQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    language: string,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (
      !createQuestionResponseAttemptRequestDto.learnerChoices ||
      createQuestionResponseAttemptRequestDto.learnerChoices.length === 0
    ) {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: [],
          feedback: this.getLocalizedString("noOptionSelected", language),
        },
      ] as unknown as ChoiceBasedFeedbackDto[];
      const learnerResponse = JSON.stringify([]);
      return { responseDto, learnerResponse };
    }

    const learnerChoices =
      createQuestionResponseAttemptRequestDto.learnerChoices;

    const normalizedLearnerChoices = new Set(
      learnerChoices.map((choice) => this.normalizeText(choice)),
    );

    const choices = this.parseChoices(question.choices);
    const normalizedChoices = choices.map((choice) => ({
      original: choice,
      normalized: this.normalizeText(choice.choice),
    }));

    const correctChoices = choices.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) =>
      this.normalizeText(choice.choice),
    );

    let totalPoints = 0;
    const feedbackDetails: string[] = [];

    for (const learnerChoice of learnerChoices) {
      const normalizedLearnerChoice = this.normalizeText(learnerChoice);
      const matchedChoice = normalizedChoices.find(
        (item) => item.normalized === normalizedLearnerChoice,
      );

      if (matchedChoice) {
        totalPoints += matchedChoice.original.points;
        const data = {
          learnerChoice,
          points: matchedChoice.original.points,
        };
        let choiceFeedback = "";
        if (matchedChoice.original.feedback) {
          choiceFeedback = this.formatFeedback(
            matchedChoice.original.feedback,
            data,
          );
        } else {
          choiceFeedback = matchedChoice.original.isCorrect
            ? this.getLocalizedString("correctSelection", language, data)
            : this.getLocalizedString("incorrectSelection", language, data);
        }
        feedbackDetails.push(choiceFeedback);
      } else {
        feedbackDetails.push(
          this.getLocalizedString("invalidSelection", language, {
            learnerChoice,
          }),
        );
      }
    }

    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + choice.points,
      0,
    );
    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));

    const allCorrectSelected = correctChoiceTexts.every((correctText) =>
      normalizedLearnerChoices.has(correctText),
    );

    const feedbackMessage = `
  ${feedbackDetails.join(".\n")}.
  ${
    totalPoints < maxPoints || !allCorrectSelected
      ? `\n${this.getLocalizedString("correctOptions", language, {
          correctOptions: correctChoices
            .map((choice) => choice.choice)
            .join(", "),
        })}`
      : this.getLocalizedString("allCorrectSelected", language)
  }
    `;

    responseDto.totalPoints = finalPoints;
    responseDto.feedback = [
      {
        choice: learnerChoices.join(", "),
        feedback: feedbackMessage.trim(),
      },
    ];
    const learnerResponse = JSON.stringify(learnerChoices);
    return { responseDto, learnerResponse };
  }

  private normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()

      .replaceAll(/[!,.،؛؟]/g, "");
  }
  /**
   * Calculates the time range start date based on the assignment settings.
   * @param assignment The assignment object.
   * @returns The time range start date.
   */
  private calculateTimeRangeStartDate(
    assignment: LearnerGetAssignmentResponseDto,
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

  private getLocalizedString(
    key: string,
    language: string,
    placeholders?: { [key: string]: string | number },
  ): string {
    const translations: Record<string, any> = {
      en: {
        noResponse: "You did not provide a response to this question.",
        expectedTrueFalse:
          "Expected a true/false response, but did not receive one.",
        invalidTrueFalse: "Invalid true/false response.",
        correctTF: "Correct! Your answer is right.",
        incorrectTF: "Incorrect. The correct answer is {correctAnswer}.",
        true: "True",
        false: "False",
        correctSelection:
          "**Correct selection:** {learnerChoice} (+{points} points)",
        incorrectSelection:
          "**Incorrect selection:** {learnerChoice} (-{points} points)",
        invalidSelection: "**Invalid selection:** {learnerChoice}",
        noOptionSelected: "**You didn't select any option.**",
        correctOptions: "The correct option(s) were: **{correctOptions}**.",
        allCorrectSelected: "**You selected all correct options!**",
      },
      ar: {
        noResponse: "لم تقدم إجابة على هذا السؤال.",
        expectedTrueFalse:
          "كان من المتوقع الحصول على إجابة صحيحة/خاطئة، ولكن لم يتم الحصول عليها.",
        invalidTrueFalse: "إجابة صحيحة/خاطئة غير صالحة.",
        correctTF: "صحيح! إجابتك صحيحة.",
        incorrectTF: "خطأ. الإجابة الصحيحة هي {correctAnswer}.",
        true: "صحيح",
        false: "خطأ",
        correctSelection:
          "**الاختيار الصحيح:** {learnerChoice} (+{points} نقطة)",
        incorrectSelection:
          "**الاختيار غير الصحيح:** {learnerChoice} (-{points} نقطة)",
        invalidSelection: "**الاختيار غير صالح:** {learnerChoice}",
        noOptionSelected: "**لم تختر أي خيار.**",
        correctOptions: "الخيارات الصحيحة هي: **{correctOptions}**.",
        allCorrectSelected: "**لقد اخترت جميع الخيارات الصحيحة!**",
      },
      id: {
        noResponse: "Anda tidak memberikan jawaban untuk pertanyaan ini.",
        expectedTrueFalse:
          "Diharapkan jawaban benar/salah, tetapi tidak diterima.",
        invalidTrueFalse: "Jawaban benar/salah tidak valid.",
        correctTF: "Benar! Jawaban Anda benar.",
        incorrectTF: "Salah. Jawaban yang benar adalah {correctAnswer}.",
        true: "Benar",
        false: "Salah",
        correctSelection: "**Pilihan benar:** {learnerChoice} (+{points} poin)",
        incorrectSelection:
          "**Pilihan salah:** {learnerChoice} (-{points} poin)",
        invalidSelection: "**Pilihan tidak valid:** {learnerChoice}",
        noOptionSelected: "**Anda tidak memilih opsi apa pun.**",
        correctOptions: "Opsi yang benar adalah: **{correctOptions}**.",
        allCorrectSelected: "**Anda memilih semua opsi yang benar!**",
      },
      de: {
        noResponse: "Sie haben keine Antwort auf diese Frage gegeben.",
        expectedTrueFalse:
          "Eine Ja/Nein-Antwort wurde erwartet, aber nicht erhalten.",
        invalidTrueFalse: "Ungültige Ja/Nein-Antwort.",
        correctTF: "Richtig! Ihre Antwort ist korrekt.",
        incorrectTF: "Falsch. Die richtige Antwort ist {correctAnswer}.",
        true: "Wahr",
        false: "Falsch",
        correctSelection:
          "**Richtige Auswahl:** {learnerChoice} (+{points} Punkte)",
        incorrectSelection:
          "**Falsche Auswahl:** {learnerChoice} (-{points} Punkte)",
        invalidSelection: "**Ungültige Auswahl:** {learnerChoice}",
        noOptionSelected: "**Sie haben keine Option ausgewählt.**",
        correctOptions:
          "Die richtige(n) Option(en) waren: **{correctOptions}**.",
        allCorrectSelected: "**Sie haben alle richtigen Optionen ausgewählt!**",
      },
      es: {
        noResponse: "No proporcionaste una respuesta a esta pregunta.",
        expectedTrueFalse:
          "Se esperaba una respuesta verdadero/falso, pero no se recibió.",
        invalidTrueFalse: "Respuesta verdadero/falso inválida.",
        correctTF: "¡Correcto! Tu respuesta es correcta.",
        incorrectTF: "Incorrecto. La respuesta correcta es {correctAnswer}.",
        true: "Verdadero",
        false: "Falso",
        correctSelection:
          "**Selección correcta:** {learnerChoice} (+{points} puntos)",
        incorrectSelection:
          "**Selección incorrecta:** {learnerChoice} (-{points} puntos)",
        invalidSelection: "**Selección inválida:** {learnerChoice}",
        noOptionSelected: "**No seleccionaste ninguna opción.**",
        correctOptions:
          "La(s) opción(es) correcta(s) eran: **{correctOptions}**.",
        allCorrectSelected: "**¡Seleccionaste todas las opciones correctas!**",
      },
      fr: {
        noResponse: "Vous n'avez pas répondu à cette question.",
        expectedTrueFalse:
          "Une réponse vrai/faux était attendue, mais non reçue.",
        invalidTrueFalse: "Réponse vrai/faux invalide.",
        correctTF: "Correct ! Votre réponse est juste.",
        incorrectTF: "Incorrect. La bonne réponse est {correctAnswer}.",
        true: "Vrai",
        false: "Faux",
        correctSelection:
          "**Sélection correcte:** {learnerChoice} (+{points} points)",
        incorrectSelection:
          "**Sélection incorrecte:** {learnerChoice} (-{points} points)",
        invalidSelection: "**Sélection invalide:** {learnerChoice}",
        noOptionSelected: "**Vous n'avez sélectionné aucune option.**",
        correctOptions: "Les options correctes étaient: **{correctOptions}**.",
        allCorrectSelected:
          "**Vous avez sélectionné toutes les options correctes !**",
      },
      it: {
        noResponse: "Non hai fornito una risposta a questa domanda.",
        expectedTrueFalse:
          "Era prevista una risposta vero/falso, ma non è stata ricevuta.",
        invalidTrueFalse: "Risposta vero/falso non valida.",
        correctTF: "Corretto! La tua risposta è giusta.",
        incorrectTF: "Sbagliato. La risposta corretta è {correctAnswer}.",
        true: "Vero",
        false: "Falso",
        correctSelection:
          "**Selezione corretta:** {learnerChoice} (+{points} punti)",
        incorrectSelection:
          "**Selezione errata:** {learnerChoice} (-{points} punti)",
        invalidSelection: "**Selezione non valida:** {learnerChoice}",
        noOptionSelected: "**Non hai selezionato nessuna opzione.**",
        correctOptions: "Le opzioni corrette erano: **{correctOptions}**.",
        allCorrectSelected: "**Hai selezionato tutte le opzioni corrette!**",
      },
      hu: {
        noResponse: "Nem adtál választ erre a kérdésre.",
        expectedTrueFalse: "Igaz/Hamis választ vártunk, de nem érkezett.",
        invalidTrueFalse: "Érvénytelen igaz/hamis válasz.",
        correctTF: "Helyes! A válaszod megfelelő.",
        incorrectTF: "Helytelen. A helyes válasz: {correctAnswer}.",
        true: "Igaz",
        false: "Hamis",
        correctSelection:
          "**Helyes választás:** {learnerChoice} (+{points} pont)",
        incorrectSelection:
          "**Helytelen választás:** {learnerChoice} (-{points} pont)",
        invalidSelection: "**Érvénytelen választás:** {learnerChoice}",
        noOptionSelected: "**Nem választottál ki egy lehetőséget sem.**",
        correctOptions: "A helyes lehetőségek: **{correctOptions}**.",
        allCorrectSelected: "**Minden helyes lehetőséget kiválasztottál!**",
      },
      nl: {
        noResponse: "Je hebt geen antwoord gegeven op deze vraag.",
        expectedTrueFalse:
          "Een waar/onwaar antwoord werd verwacht, maar niet ontvangen.",
        invalidTrueFalse: "Ongeldig waar/onwaar antwoord.",
        correctTF: "Correct! Je antwoord is juist.",
        incorrectTF: "Onjuist. Het juiste antwoord is {correctAnswer}.",
        true: "Waar",
        false: "Onwaar",
        correctSelection:
          "**Juiste keuze:** {learnerChoice} (+{points} punten)",
        incorrectSelection:
          "**Onjuiste keuze:** {learnerChoice} (-{points} punten)",
        invalidSelection: "**Ongeldige keuze:** {learnerChoice}",
        noOptionSelected: "**Je hebt geen optie geselecteerd.**",
        correctOptions: "De juiste opties waren: **{correctOptions}**.",
        allCorrectSelected: "**Je hebt alle juiste opties geselecteerd!**",
      },
      pl: {
        noResponse: "Nie udzieliłeś odpowiedzi na to pytanie.",
        expectedTrueFalse:
          "Oczekiwano odpowiedzi prawda/fałsz, ale jej nie otrzymano.",
        invalidTrueFalse: "Nieprawidłowa odpowiedź prawda/fałsz.",
        correctTF: "Poprawnie! Twoja odpowiedź jest właściwa.",
        incorrectTF: "Niepoprawnie. Poprawna odpowiedź to {correctAnswer}.",
        true: "Prawda",
        false: "Fałsz",
        correctSelection:
          "**Poprawny wybór:** {learnerChoice} (+{points} punkty)",
        incorrectSelection:
          "**Niepoprawny wybór:** {learnerChoice} (-{points} punkty)",
        invalidSelection: "**Nieprawidłowy wybór:** {learnerChoice}",
        noOptionSelected: "**Nie wybrałeś żadnej opcji.**",
        correctOptions: "Poprawne opcje to: **{correctOptions}**.",
        allCorrectSelected: "**Wybrałeś wszystkie poprawne opcje!**",
      },
      pt: {
        noResponse: "Você não forneceu uma resposta para esta pergunta.",
        expectedTrueFalse:
          "Era esperada uma resposta verdadeiro/falso, mas não foi recebida.",
        invalidTrueFalse: "Resposta verdadeiro/falso inválida.",
        correctTF: "Correto! Sua resposta está certa.",
        incorrectTF: "Incorreto. A resposta correta é {correctAnswer}.",
        true: "Verdadeiro",
        false: "Falso",
        correctSelection:
          "**Seleção correta:** {learnerChoice} (+{points} pontos)",
        incorrectSelection:
          "**Seleção incorreta:** {learnerChoice} (-{points} pontos)",
        invalidSelection: "**Seleção inválida:** {learnerChoice}",
        noOptionSelected: "**Você não selecionou nenhuma opção.**",
        correctOptions: "As opções corretas eram: **{correctOptions}**.",
        allCorrectSelected: "**Você selecionou todas as opções corretas!**",
      },
      tr: {
        noResponse: "Bu soruya bir yanıt vermediniz.",
        expectedTrueFalse: "Doğru/Yanlış yanıt bekleniyordu, ancak alınmadı.",
        invalidTrueFalse: "Geçersiz doğru/yanlış yanıt.",
        correctTF: "Doğru! Cevabınız doğru.",
        incorrectTF: "Yanlış. Doğru cevap {correctAnswer}.",
        true: "Doğru",
        false: "Yanlış",
        correctSelection: "**Doğru seçim:** {learnerChoice} (+{points} puan)",
        incorrectSelection:
          "**Yanlış seçim:** {learnerChoice} (-{points} puan)",
        invalidSelection: "**Geçersiz seçim:** {learnerChoice}",
        noOptionSelected: "**Hiçbir seçenek seçmediniz.**",
        correctOptions: "Doğru seçenekler: **{correctOptions}**.",
        allCorrectSelected: "**Tüm doğru seçenekleri seçtiniz!**",
      },
      ru: {
        noResponse: "Вы не дали ответа на этот вопрос.",
        expectedTrueFalse: "Ожидался ответ правда/ложь, но он не был получен.",
        invalidTrueFalse: "Недопустимый ответ правда/ложь.",
        correctTF: "Верно! Ваш ответ правильный.",
        incorrectTF: "Неверно. Правильный ответ: {correctAnswer}.",
        true: "Правда",
        false: "Ложь",
        correctSelection:
          "**Правильный выбор:** {learnerChoice} (+{points} очков)",
        incorrectSelection:
          "**Неправильный выбор:** {learnerChoice} (-{points} очков)",
        invalidSelection: "**Недопустимый выбор:** {learnerChoice}",
        noOptionSelected: "**Вы не выбрали ни одного варианта.**",
        correctOptions: "Правильные варианты: **{correctOptions}**.",
        allCorrectSelected: "**Вы выбрали все правильные варианты!**",
      },
      ja: {
        noResponse: "この質問に対する回答を提供しませんでした。",
        expectedTrueFalse:
          "正誤の回答が期待されましたが、受け取られませんでした。",
        invalidTrueFalse: "無効な正誤の回答。",
        correctTF: "正解！あなたの答えは正しいです。",
        incorrectTF: "不正解。正しい答えは {correctAnswer} です。",
        true: "正しい",
        false: "間違い",
        correctSelection: "**正しい選択:** {learnerChoice} (+{points} 点)",
        incorrectSelection: "**間違った選択:** {learnerChoice} (-{points} 点)",
        invalidSelection: "**無効な選択:** {learnerChoice}",
        noOptionSelected: "**オプションを選択しませんでした。**",
        correctOptions: "正しいオプションは: **{correctOptions}** でした。",
        allCorrectSelected: "**すべての正しいオプションを選択しました！**",
      },
      "zh-CN": {
        noResponse: "你没有回答这个问题。",
        expectedTrueFalse: "预期是一个真/假回答，但未收到。",
        invalidTrueFalse: "无效的真/假回答。",
        correctTF: "正确！你的回答是对的。",
        incorrectTF: "错误。正确答案是 {correctAnswer}。",
        true: "真",
        false: "假",
        correctSelection: "**正确选择:** {learnerChoice} (+{points} 分)",
        incorrectSelection: "**错误选择:** {learnerChoice} (-{points} 分)",
        invalidSelection: "**无效选择:** {learnerChoice}",
        noOptionSelected: "**你没有选择任何选项。**",
        correctOptions: "正确的选项是: **{correctOptions}**。",
        allCorrectSelected: "**你选择了所有正确的选项！**",
      },

      "zh-TW": {
        noResponse: "你沒有回答這個問題。",
        expectedTrueFalse: "預期是一個真/假回答，但未收到。",
        invalidTrueFalse: "無效的真/假回答。",
        correctTF: "正確！你的回答是對的。",
        incorrectTF: "錯誤。正確答案是 {correctAnswer}。",
        true: "真",
        false: "假",
        correctSelection: "**正確選擇:** {learnerChoice} (+{points} 分)",
        incorrectSelection: "**錯誤選擇:** {learnerChoice} (-{points} 分)",
        invalidSelection: "**無效選擇:** {learnerChoice}",
        noOptionSelected: "**你沒有選擇任何選項。**",
        correctOptions: "正確的選項是: **{correctOptions}**。",
        allCorrectSelected: "**你選擇了所有正確的選項！**",
      },
    };

    const langDict = (translations[language] || translations["en"]) as Record<
      string,
      string
    >;
    let string_ = langDict[key] || key;

    if (placeholders) {
      for (const placeholder in placeholders) {
        const regex = new RegExp(`{${placeholder}}`, "g");
        string_ = string_.replace(regex, String(placeholders[placeholder]));
      }
    }
    return string_;
  }

  private parseBooleanResponse(
    learnerChoice: string,
    language: string,
  ): boolean | null {
    const mapping: Record<string, Record<string, boolean>> = {
      en: { true: true, false: false },
      id: { benar: true, salah: false },
      de: { wahr: true, falsch: false },
      es: { verdadero: true, falso: false },
      fr: { vrai: true, faux: false },
      it: { vero: true, falso: false },
      hu: { igaz: true, hamis: false },
      nl: { waar: true, onwaar: false },
      pl: { prawda: true, fałsz: false },
      pt: { verdadeiro: true, falso: false },
      sv: { sant: true, falskt: false },
      tr: { doğru: true, yanlış: false },
      el: { αληθές: true, ψευδές: false },
      kk: { рас: true, жалған: false },
      ru: { правда: true, ложь: false },
      uk: { правда: true, брехня: false },
      ar: { صحيح: true, خطأ: false },
      hi: { सही: true, गलत: false },
      th: { จริง: true, เท็จ: false },
      ko: { 참: true, 거짓: false },
      "zh-CN": { 真: true, 假: false },
      "zh-TW": { 真: true, 假: false },
      ja: { 正しい: true, 間違い: false },
    };

    const langMapping = mapping[language] || mapping["en"];
    const normalized = learnerChoice.trim().toLowerCase();
    return langMapping[normalized] === undefined
      ? undefined
      : langMapping[normalized];
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
      const extendedQuestion = question as ExtendedQuestion;
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

  /**
   * Retrieves the assignment context required for grading.
   * @param assignmentId The assignment ID.
   * @param questionId The question ID.
   * @param assignmentAttemptId The assignment attempt ID.
   * @returns An object containing assignment instructions and question answer context.
   */
  private async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
    role: UserRole,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: Assignment,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    let assignmentInstructions = "";
    let questionsAnswersContext: QuestionAnswerContext[] = [];

    if (role === UserRole.AUTHOR && assignmentDetails && authorQuestions) {
      assignmentInstructions = assignmentDetails.instructions || "";
      const authorQuestion = authorQuestions.find((q) => q.id === questionId);

      if (!authorQuestion) {
        throw new Error("Question not found in author questions.");
      }

      questionsAnswersContext = authorQuestions.map((q) => ({
        question: q.question,
        answer: "",
      }));
    } else {
      const assignment = await this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { instructions: true },
      });

      assignmentInstructions = assignment.instructions || "";

      const question = await this.prisma.question.findUnique({
        where: { id: questionId },
        select: { gradingContextQuestionIds: true },
      });

      if (!question) {
        throw new Error("Question not found.");
      }

      const contextQuestions = await this.prisma.question.findMany({
        where: {
          id: {
            in: question.gradingContextQuestionIds,
          },
        },
        select: { id: true, question: true, type: true },
      });

      const allResponses = await this.prisma.questionResponse.findMany({
        where: {
          assignmentAttemptId: assignmentAttemptId,
          questionId: {
            in: question.gradingContextQuestionIds,
          },
        },
        orderBy: {
          id: "desc",
        },
      });

      const groupedResponses: {
        [key: number]: GetQuestionResponseAttemptResponseDto;
      } = {};

      for (const response of allResponses) {
        if (!groupedResponses[response.questionId]) {
          groupedResponses[response.questionId] = response;
        }
      }

      questionsAnswersContext = await Promise.all(
        contextQuestions.map(async (contextQuestion) => {
          let learnerResponse =
            groupedResponses[contextQuestion.id]?.learnerResponse || "";

          if (contextQuestion.type === "URL" && learnerResponse) {
            const urlContent =
              await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
            learnerResponse = JSON.stringify({
              url: learnerResponse,
              ...urlContent,
            });
          }

          return {
            question: contextQuestion.question,
            answer: learnerResponse,
          };
        }),
      );
    }

    return {
      assignmentInstructions,
      questionAnswerContext: questionsAnswersContext,
    };
  }
}
