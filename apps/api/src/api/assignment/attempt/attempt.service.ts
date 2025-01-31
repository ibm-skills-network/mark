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
  Question,
  QuestionType,
  RegradingStatus,
  ReportType,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { QuestionAnswerContext } from "../../../api/llm/model/base.question.evaluate.model";
import { UrlBasedQuestionEvaluateModel } from "../../../api/llm/model/url.based.question.evaluate.model";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { FileUploadQuestionEvaluateModel } from "../../llm/model/file.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { AssignmentService } from "../assignment.service";
import type { LearnerGetAssignmentResponseDto } from "../dto/get.assignment.response.dto";
import { QuestionDto } from "../dto/update.questions.request.dto";
import {
  Choice,
  Scoring,
} from "../question/dto/create.update.question.request.dto";
import { QuestionService } from "../question/question.service";
import {
  GRADE_SUBMISSION_EXCEPTION,
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
import { LearnerFileUpload } from "./dto/assignment-attempt/types";
import { UpdateAssignmentAttemptResponseDto } from "./dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
} from "./dto/question-response/create.question.response.attempt.response.dto";
import type { GetQuestionResponseAttemptResponseDto } from "./dto/question-response/get.question.response.attempt.response.dto";
import { AttemptHelper } from "./helper/attempts.helper";

//types
type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
  assignmentAttemptId?: number;
  learnerResponse?: string;
  points: number;
  feedback: object;
};

interface AssignmentAttempt {
  id: number;
  assignmentId: number;
  userId: string;
  expiresAt: Date | null;
  submitted: boolean;
  grade: number | null;
  attemptQuestionIds: number[];
  questionResponses: {
    id: number;
    questionId: number;
    assignmentAttemptId: number;
    feedback: JsonValue;
    learnerResponse: string;
    points: number;
  }[];
  questionVariants: {
    questionVariant: {
      id: number;
      variantContent: string;
      choices: JsonValue;
      maxWords: number;
      maxCharacters: number;
      scoring: JsonValue;
      answer: string;
    };
  }[];
}

@Injectable()
export class AttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService,
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

    // Correct ownership permissions are handled through AssignmentAttemptAccessControlGuard.
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
    console.log("assignment HERE", assignment);
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
      where: { assignmentId },
      include: { variants: true },
    });
    const validQuestions = questions.filter((q) => !q.isDeleted);

    const finalOrderedQuestions = [...validQuestions];
    if (assignment.displayOrder === "RANDOM") {
      finalOrderedQuestions.sort(() => Math.random() - 0.5);
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
      finalOrderedQuestions.sort(
        (a, b) =>
          assignment.questionOrder.indexOf(a.id) -
          assignment.questionOrder.indexOf(b.id),
      );
    }
    console.log("finalOrderedQuestions", finalOrderedQuestions);
    console.log("assignment.questionOrder", assignment.questionOrder);
    await this.prisma.assignmentAttempt.update({
      where: { id: assignmentAttempt.id },
      data: {
        questionOrder: finalOrderedQuestions.map((q) => q.id),
      },
    });

    const attemptQuestionVariantsData = finalOrderedQuestions.map(
      (question) => {
        const questionAndVariants = [undefined, ...question.variants];
        const randomIndex = Math.floor(
          Math.random() * questionAndVariants.length,
        );
        const chosenVariant = questionAndVariants[randomIndex];

        let variantId: number | null;
        let randomizedChoices: string | null;

        if (chosenVariant) {
          variantId = chosenVariant.id;
          const variantChoices =
            typeof chosenVariant.choices === "string"
              ? chosenVariant.choices
              : JSON.stringify(chosenVariant.choices);
          randomizedChoices = this.maybeShuffleChoices(
            variantChoices,
            chosenVariant.randomizedChoices === true,
          );
        } else {
          const questionChoices =
            typeof question.choices === "string"
              ? question.choices
              : JSON.stringify(question.choices);
          randomizedChoices = this.maybeShuffleChoices(
            questionChoices,
            question.randomizedChoices === true,
          );
        }

        return {
          assignmentAttemptId: assignmentAttempt.id,
          questionId: question.id,
          questionVariantId: variantId,
          randomizedChoices,
        };
      },
    );

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
      });
      const tenSecondsBeforeNow = new Date(Date.now() - 10 * 1000);
      if (
        assignmentAttempt.expiresAt &&
        tenSecondsBeforeNow > assignmentAttempt.expiresAt
      ) {
        // if the attempt is expired, we should allow the user to submit the attempt but not grade it
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
          feedbacksForQuestions: [],
          message: SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
        };
      }
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: {
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
      updateAssignmentAttemptDto.authorQuestions,
      updateAssignmentAttemptDto.authorAssignmentDetails,
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
      // find the highest grade for the user and send it to the LTI gateway.  This is to ensure that the grade sent to the LTI gateway is the highest grade achieved by the user so it doesnt get overwritten by a lower grade
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
      // if the request is from the author, we don't need to reflect the grade in the database since it's just a test run
      return {
        id: -1,
        submitted: true,
        success: true,
        totalPointsEarned,
        totalPossiblePoints,
        grade: assignment.showAssignmentScore ? grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
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
        grade: assignment.showAssignmentScore ? result.grade : undefined,
        showSubmissionFeedback: assignment.showSubmissionFeedback,
        feedbacksForQuestions: this.constructFeedbacksForQuestions(
          successfulQuestionResponses,
          assignment as unknown as LearnerGetAssignmentResponseDto,
        ),
      };
    }
  }
  /**
   * Retrieves and formats a learner's assignment attempt with contextual display rules.
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
      },
    });

    let questionOrder: number[] = [];
    if (
      assignmentAttempt.questionOrder &&
      assignmentAttempt.questionOrder.length > 0
    ) {
      questionOrder = assignmentAttempt.questionOrder;
    } else if (
      assignment.questionOrder &&
      assignment.questionOrder.length > 0
    ) {
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
        question: questionText,
        choices: finalChoices,
        maxWords,
        maxCharacters: maxChars,
        scoring,
        totalPoints: originalQ.totalPoints,
        answer: variant?.answer ?? originalQ?.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ?.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: originalQ.randomizedChoices,
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
      return {
        id: originalQ.id,
        question: originalQ.question,
        choices: originalQ.choices,
        maxWords: originalQ.maxWords,
        maxCharacters: originalQ.maxCharacters,
        scoring: originalQ.scoring,
        totalPoints: originalQ.totalPoints,
        answer: originalQ.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: originalQ.randomizedChoices,
      };
    });

    const questionsWithResponses = this.constructQuestionsWithResponses(
      mergedQuestions.map((question) => ({
        ...question,
        choices: JSON.stringify(question.choices) as unknown as JsonValue,
      })),
      assignmentAttempt.questionResponses as QuestionResponse[],
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
    return {
      ...assignmentAttempt,
      questions: finalQuestions.map((question) => ({
        ...question,
        choices:
          typeof question.choices === "string"
            ? (JSON.parse(question.choices) as Choice[])
            : question.choices,
      })),
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
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
   * @returns Structured attempt data with:
   * - Questions in their attempt-specific order
   * - Merged question/variant data
   * - Responses with score/feedback visibility rules applied
   * - Assignment configuration metadata
   *
   * @remarks
   * 1. Data Composition:
   *    - Combines original question data with variant overrides used in the attempt
   *    - Maintains exact question order from attempt creation
   *    - Merges stored responses with corresponding questions
   *
   * 2. Display Enforcement:
   *    - Controls visibility of sensitive data through:
   *      - Grade suppression (showAssignmentScore)
   *      - Feedback removal (showSubmissionFeedback)
   *      - Score masking (showQuestionScore)
   *
   * 3. Data Handling:
   *    - Filters out deleted questions from results
   *    - Parses stored JSON choice data when needed
   *    - Falls back to original question data when variants are unavailable
   *    - Handles both stringified and object-based choice storage formats
   *
   * 4. Security:
   *    - Ensures answers/scoring remain hidden per assignment settings
   *    - Validates existence of all referenced database entities
   *    - Maintains data integrity through strict typing
   *
   * @throws NotFoundException If the attempt or related assignment cannot be found
   * @throws BadRequestException For malformed stored data (invalid JSON formats)
   */
  async getAssignmentAttempt(
    assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: {
        questionResponses: true,
        questionVariants: {
          include: {
            questionVariant: true,
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
        questions: {
          where: {
            isDeleted: false,
          },
        },
        questionOrder: true,
        displayOrder: true,
        passingGrade: true,
        showAssignmentScore: true,
        showSubmissionFeedback: true,
        showQuestionScore: true,
      },
    })) as LearnerGetAssignmentResponseDto;

    const questionOrder =
      assignmentAttempt.questionOrder || assignment.questionOrder || [];

    const questionById = new Map(assignment.questions.map((q) => [q.id, q]));

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
        question: questionText,
        choices: finalChoices,
        maxWords,
        maxCharacters: maxChars,
        scoring,
        totalPoints: originalQ.totalPoints,
        answer: variant?.answer ?? originalQ?.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ?.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: originalQ.randomizedChoices,
      };
    });

    const questionVariantsMap = new Map(
      questionsWithVariants.map((question) => [question.id, question]),
    );
    const questions: Question[] = await this.prisma.question.findMany({
      where: { assignmentId: assignmentAttempt.assignmentId },
    });
    const mergedQuestions = questions.map((originalQ: Question) => {
      const variantQ = questionVariantsMap.get(originalQ.id);
      if (variantQ) {
        return variantQ;
      }
      return {
        id: originalQ.id,
        question: originalQ.question,
        choices: originalQ.choices,
        maxWords: originalQ.maxWords,
        maxCharacters: originalQ.maxCharacters,
        scoring: originalQ.scoring,
        totalPoints: originalQ.totalPoints,
        answer: originalQ.answer,
        type: originalQ.type,
        assignmentId: originalQ.assignmentId,
        gradingContextQuestionIds: originalQ.gradingContextQuestionIds,
        responseType: originalQ.responseType,
        isDeleted: originalQ.isDeleted,
        randomizedChoices: originalQ.randomizedChoices,
      };
    });
    const validQuestions = mergedQuestions.filter(
      Boolean,
    ) as unknown as Question[];

    const questionsWithResponses = this.constructQuestionsWithResponses(
      validQuestions.map((q) => ({
        ...q,
        choices:
          typeof q.choices === "string" ? q.choices : JSON.stringify(q.choices),
      })),
      assignmentAttempt.questionResponses as QuestionResponse[],
    );

    const finalQuestions =
      questionOrder.length > 0
        ? questionOrder
            .map((qId) => questionsWithResponses.find((q) => q.id === qId))
            .filter(Boolean)
        : questionsWithResponses;
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
        if (typeof q.questionResponses[0]?.points === "number") {
          q.questionResponses[0].points = -1;
        }
      }
    }
    return {
      ...assignmentAttempt,
      questions: finalQuestions,
      passingGrade: assignment.passingGrade,
      showAssignmentScore: assignment.showAssignmentScore,
      showSubmissionFeedback: assignment.showSubmissionFeedback,
      showQuestionScore: assignment.showQuestionScore,
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
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let question: QuestionDto;
    let assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };

    if (role === UserRole.LEARNER) {
      // Fetch the assignment attempt, including the selected variants
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: assignmentAttemptId },
        include: {
          questionVariants: {
            select: {
              questionId: true,
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
      const variantMapping = assignmentAttempt.questionVariants.find(
        (qv) => qv.questionId === questionId,
      );
      if (variantMapping && variantMapping.questionVariant) {
        const variant = variantMapping.questionVariant;
        const baseQuestion = variant.variantOf;
        question = {
          id: variant.id,
          question: variant.variantContent,
          type: baseQuestion.type,
          assignmentId: baseQuestion.assignmentId,
          maxWords: variant.maxWords ?? baseQuestion.maxWords,
          maxCharacters: variant.maxCharacters ?? baseQuestion.maxCharacters,
          scoring:
            typeof variant.scoring === "string"
              ? (JSON.parse(variant.scoring) as Scoring)
              : ((variant.scoring as unknown as Scoring) ??
                (typeof baseQuestion.scoring === "string"
                  ? (JSON.parse(baseQuestion.scoring) as Scoring)
                  : (baseQuestion.scoring as unknown as Scoring))),
          choices:
            typeof variant.choices === "string"
              ? (JSON.parse(variant.choices) as Choice[])
              : ((variant.choices as unknown as Choice[]) ??
                (typeof baseQuestion.choices === "string"
                  ? (JSON.parse(baseQuestion.choices) as Choice[])
                  : (baseQuestion.choices as unknown as Choice[]))),

          answer: variant.answer ?? baseQuestion.answer,
          alreadyInBackend: true,
          totalPoints: baseQuestion.totalPoints,
        };
      } else {
        question = await this.questionService.findOne(questionId);
      }

      assignmentContext = await this.getAssignmentContext(
        assignmentAttempt.assignmentId,
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
    );
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentAttemptId:
          role === UserRole.LEARNER ? assignmentAttemptId : 1,
        questionId: questionId,
        learnerResponse: JSON.stringify(learnerResponse),
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
    // Ensure the assignment exists
    const assignmentExists = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
    });

    if (!assignmentExists) {
      throw new NotFoundException("Assignment not found");
    }
    // check if assignment attempt exists
    const assignmentAttemptExists =
      await this.prisma.assignmentAttempt.findUnique({
        where: { id: attemptId },
      });
    if (!assignmentAttemptExists) {
      throw new NotFoundException("Assignment attempt not found");
    }
    // if the user created more than 5 reports in the last 24 hours, throw an error
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

    // Create a new report
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
  // ==================== PRIVATE METHODS ====================

  /**
   * Validates whether a new attempt can be created for the given assignment and user session.
   * @param assignment The assignment object.
   * @param userSession The user session.
   */
  private async validateNewAttempt(
    assignment: LearnerGetAssignmentResponseDto,
    userSession: UserSession,
  ): Promise<void> {
    const timeRangeStartDate = this.calculateTimeRangeStartDate(assignment);

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignment.id,
        OR: [
          {
            submitted: false,
            expiresAt: {
              gte: new Date(),
            },
          },
          {
            submitted: false,
            expiresAt: undefined,
          },
          {
            createdAt: {
              gte: timeRangeStartDate,
              lte: new Date(),
            },
          },
        ],
      },
    });
    const ongoingAttempts = attempts.filter(
      (sub) =>
        !sub.submitted &&
        (sub.expiresAt >= new Date() || sub.expiresAt === null),
    );

    const attemptsInTimeRange = attempts.filter(
      (sub) =>
        sub.createdAt >= timeRangeStartDate && sub.createdAt <= new Date(),
    );
    if (ongoingAttempts.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }

    if (
      assignment.attemptsPerTimeRange &&
      attemptsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
      );
    }
    if (assignment.numAttempts !== null && assignment.numAttempts !== -1) {
      const attemptCount = await this.countUserAttempts(
        userSession.userId,
        assignment.id,
      );

      if (attemptCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
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

  private maybeShuffleChoices = (
    choices: Choice[] | string | null | undefined,
    shouldShuffle: boolean,
  ): string | null => {
    if (!choices) return;

    let parsed: Choice[] =
      typeof choices === "string" ? (JSON.parse(choices) as Choice[]) : choices;

    if (shouldShuffle) {
      parsed = [...parsed];
      parsed.sort(() => Math.random() - 0.5);
    }
    return JSON.stringify(parsed);
  };
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
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
  ): Promise<CreateQuestionResponseAttemptResponseDto[]> {
    const questionResponsesPromise = responsesForQuestions.map(
      async (questionResponse) => {
        const { id: questionId, ...cleanedQuestionResponse } = questionResponse;
        return await this.createQuestionResponse(
          assignmentAttemptId,
          questionId,
          cleanedQuestionResponse,
          role,
          assignmentId,
          authorQuestions,
          assignmentDetails,
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
        `Failed to submit questions: ${failedResponses
          .map((response) => response)
          .join(", ")}`,
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
    // Omit fields that shouldn't be part of the update
    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      responsesForQuestions,
      authorQuestions, // removing author questions from the update request
      authorAssignmentDetails, // removing author assignment details from the update request
      ...cleanedUpdateAssignmentAttemptDto
    } = updateAssignmentAttemptDto;

    return this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateAssignmentAttemptDto,
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
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string | { filename: string; content: string }[];
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
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null
    ) {
      const responseDto = new CreateQuestionResponseAttemptResponseDto();
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          feedback: "You did not provide a response to this question.",
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
        );
      }
      case QuestionType.LINK_FILE: {
        if (createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
          return this.handleUrlQuestionResponse(
            question,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
            assignmentId,
          );
        } else if (
          createQuestionResponseAttemptRequestDto.learnerFileResponse
        ) {
          return this.handleFileUploadQuestionResponse(
            question,
            question.type,
            createQuestionResponseAttemptRequestDto,
            assignmentContext,
          );
        } else {
          throw new BadRequestException(
            "Expected a file-based response (learnerFileResponse) or URL-based response (learnerUrlResponse), but did not receive one.",
          );
        }
      }
      case QuestionType.UPLOAD: {
        return this.handleFileUploadQuestionResponse(
          question,
          question.type,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
        );
      }
      case QuestionType.URL: {
        return this.handleUrlQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
          assignmentContext,
          assignmentId,
        );
      }
      case QuestionType.TRUE_FALSE: {
        return this.handleTrueFalseQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      case QuestionType.SINGLE_CORRECT: {
        return this.handleSingleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      case QuestionType.MULTIPLE_CORRECT: {
        return this.handleMultipleCorrectQuestionResponse(
          question,
          createQuestionResponseAttemptRequestDto,
        );
      }
      default: {
        throw new Error("Invalid question type provided.");
      }
    }
  }

  private async handleFileUploadQuestionResponse(
    question: QuestionDto,
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    },
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
      question.scoring?.criteria ?? {},
      questionType,
      question.responseType ?? "OTHER",
    );
    const model = await this.llmService.gradeFileBasedQuestion(
      fileUploadQuestionEvaluateModel,
      question.assignmentId,
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
      question.scoring?.criteria ?? {},
      question.responseType ?? "OTHER",
    );

    const model = await this.llmService.gradeTextBasedQuestion(
      textBasedQuestionEvaluateModel,
      assignmentId,
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
      question.scoring?.criteria ?? {},
      question.responseType ?? "OTHER",
    );

    const model = await this.llmService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
      assignmentId,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(model, responseDto);

    return { responseDto, learnerResponse };
  }

  /**
   * Handles true/false question responses.
   */
  private handleTrueFalseQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    if (
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === null ||
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice === undefined
    ) {
      throw new BadRequestException(
        "Expected a true/false response (learnerAnswerChoice), but did not receive one.",
      );
    }
    const correctAnswer =
      question.choices?.[0]?.choice.toLowerCase() === "true";
    const correctPoints = question.choices?.[0]?.points || 0;
    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerAnswerChoice;
    const isCorrect = learnerChoice === correctAnswer;
    const feedback = isCorrect
      ? "Correct! Your answer is right."
      : `Incorrect. The correct answer is ${correctAnswer ? "True" : "False"}.`;

    const pointsAwarded = isCorrect ? correctPoints : 0;

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    responseDto.totalPoints = pointsAwarded;
    responseDto.feedback = [{ feedback, choice: learnerChoice }];

    const learnerResponse = JSON.stringify(learnerChoice);
    return { responseDto, learnerResponse };
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
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    // Ensure choices is an array
    const choices = this.parseChoices(question.choices);

    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerChoices[0];

    const correctChoice = choices.find((choice) => choice.isCorrect);

    const selectedChoice = choices.find(
      (choice) => choice.choice === learnerChoice,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    const data = {
      learnerChoice,
      correctChoice: correctChoice?.choice,
      points: selectedChoice?.points || 0,
    };

    if (selectedChoice) {
      let choiceFeedback = "";
      if (selectedChoice.feedback) {
        // Use custom feedback from the selected choice
        choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
      } else {
        // Use default feedback if custom feedback is not provided
        choiceFeedback = selectedChoice.isCorrect
          ? `**Correct selection:** ${learnerChoice} (+ ${selectedChoice.points} points)`
          : `**Incorrect selection:** ${learnerChoice} (- ${selectedChoice.points} points)`;
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
      // The learner selected an invalid choice
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: `**Invalid selection:** ${learnerChoice}`,
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
          feedback: "**You didn't select any option.**",
        },
      ] as unknown as ChoiceBasedFeedbackDto[];
      const learnerResponse = JSON.stringify([]);
      return { responseDto, learnerResponse };
    }

    const learnerChoices =
      createQuestionResponseAttemptRequestDto.learnerChoices;
    console.log("learnerChoices", learnerChoices);
    const choices = this.parseChoices(question.choices);
    console.log("Backend choices", choices);
    const correctChoices = choices.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) => choice.choice);
    let totalPoints = 0;
    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + choice.points,
      0,
    );
    const feedbackDetails: string[] = [];

    for (const learnerChoice of learnerChoices) {
      const selectedChoice = choices.find(
        (choice) => choice.choice === learnerChoice,
      );

      const data = {
        learnerChoice,
        points: selectedChoice?.points || 0,
      };
      console.log("selectedChoice", selectedChoice);
      if (selectedChoice) {
        totalPoints += selectedChoice.points;

        let choiceFeedback = "";
        if (selectedChoice.feedback) {
          choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
        } else {
          choiceFeedback = selectedChoice.isCorrect
            ? `**Correct selection:** ${learnerChoice} (+${selectedChoice.points} points)`
            : `**Incorrect selection:** ${learnerChoice} (${selectedChoice.points} points)`;
        }
        feedbackDetails.push(choiceFeedback);
      } else {
        feedbackDetails.push(
          `**Invalid selection:** ${learnerChoice} (0 points)`,
        );
      }
    }

    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));
    const allCorrectSelected = correctChoiceTexts.every((choice) =>
      learnerChoices.includes(choice),
    );

    const feedbackMessage = `
${feedbackDetails.join(".\n")}.
${
  totalPoints < maxPoints || !allCorrectSelected
    ? `\nThe correct option(s) were: **${correctChoiceTexts.join(", ")}**.`
    : "\n**You selected all correct options!**"
}
`;

    const feedback: ChoiceBasedFeedbackDto[] = [
      {
        choice: learnerChoices.join(", "),
        feedback: feedbackMessage.trim(),
      },
    ];
    responseDto.totalPoints = finalPoints;
    responseDto.feedback = feedback;

    const learnerResponse = JSON.stringify(learnerChoices);
    return { responseDto, learnerResponse };
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
      const correspondingResponses = questionResponses
        .filter((response) => response.questionId === question.id)
        .map((response) => ({
          id: response.id,
          assignmentAttemptId: response.assignmentAttemptId,
          questionId: response.questionId,
          learnerResponse: response.learnerResponse,
          points: response.points,
          feedback: response.feedback,
        }));

      // If choices are stored as JSON, ensure they are parsed properly into an array of objects
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

      // Ensure the choices are in the expected format
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
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        maxCharacters: question.maxCharacters,
        type: question.type,
        question: question.question,
        choices: formattedChoices, // Use the formatted choices
        assignmentId: question.assignmentId,
        alreadyInBackend: true,
        questionResponses: correspondingResponses,
        responseType: question.responseType,
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
      // Use the provided assignment details and questions for the author mode
      assignmentInstructions = assignmentDetails.instructions || "";
      const authorQuestion = authorQuestions.find((q) => q.id === questionId);

      if (!authorQuestion) {
        throw new Error("Question not found in author questions.");
      }

      questionsAnswersContext = authorQuestions.map((q) => ({
        question: q.question,
        answer: "", // No learner answers available in author mode
      }));
    } else {
      // Default behavior for learner mode
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
