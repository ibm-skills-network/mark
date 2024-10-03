import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Assignment, Question, QuestionType } from "@prisma/client";
import { QuestionAnswerContext } from "../../../api/llm/model/base.question.evaluate.model";
import { UrlBasedQuestionEvaluateModel } from "../../../api/llm/model/url.based.question.evaluate.model";
import {
  UserRole,
  UserSession,
  UserSessionRequest,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { AssignmentService } from "../assignment.service";
import type { LearnerGetAssignmentResponseDto } from "../dto/get.assignment.response.dto";
import { QuestionDto } from "../dto/update.questions.request.dto";
import { Choice } from "../question/dto/create.update.question.request.dto";
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
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import type { AssignmentAttemptQuestions } from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
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

@Injectable()
export class AttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService,
    private readonly httpService: HttpService,
  ) {}

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
   * Creates a new assignment attempt for the given assignment and user session.
   * @param assignmentId The ID of the assignment.
   * @param userSession The user session.
   * @returns A base assignment attempt response DTO.
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

    const result = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId: assignmentId,
        grade: undefined,
        userId: userSession.userId,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  /**
   * Updates an assignment attempt with the provided responses and calculates the grade.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param assignmentId The ID of the assignment.
   * @param updateAssignmentAttemptDto The update request DTO.
   * @param authCookie The authentication cookie for LTI gateway.
   * @param gradingCallbackRequired Whether a grading callback is required.
   * @returns An update assignment attempt response DTO.
   */
  async updateAssignmentAttempt(
    assignmentAttemptId: number,
    assignmentId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
    request: UserSessionRequest,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const { role } = request.userSession;
    if (role === UserRole.LEARNER) {
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: assignmentAttemptId },
      });
      this.validateAssignmentAttemptExpiry(assignmentAttempt.expiresAt);
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { questions: true },
    });
    const successfulQuestionResponses = await this.submitQuestions(
      updateAssignmentAttemptDto.responsesForQuestions as QuestionResponse[],
      assignmentAttemptId,
      role,
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

    if (gradingCallbackRequired) {
      await this.sendGradeToLtiGateway(grade, authCookie);
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
   * Retrieves an assignment attempt along with its questions and responses.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @returns A get assignment attempt response DTO.
   */
  async getAssignmentAttempt(
    assignmentAttemptId: number,
  ): Promise<GetAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
      include: { questionResponses: true },
    });

    if (!assignmentAttempt) {
      throw new NotFoundException(
        `AssignmentAttempt with Id ${assignmentAttemptId} not found.`,
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

    this.sortAssignmentQuestions(assignment as LearnerGetAssignmentResponseDto);

    const questions = this.constructQuestionsWithResponses(
      assignment.questions,
      assignmentAttempt.questionResponses as unknown as QuestionResponse[],
    );
    delete assignmentAttempt.questionResponses;
    if (assignment.showAssignmentScore === false) {
      delete assignmentAttempt.grade;
    }
    if (assignment.showSubmissionFeedback === false) {
      for (const q of questions) {
        if (q.questionResponses[0]?.feedback) {
          delete q.questionResponses[0].feedback;
        }
      }
    }
    if (assignment.showQuestionScore === false) {
      for (const q of questions) {
        if (q.questionResponses[0]?.points !== undefined) {
          // replace the points with -1 to indicate that the points should not be shown
          q.questionResponses[0].points = -1;
        }
      }
    }
    console.log("returning body", {
      ...assignmentAttempt,
      questions,
      passingGrade: assignment.passingGrade,
    });

    return {
      ...assignmentAttempt,
      questions,
      passingGrade: assignment.passingGrade,
    };
  }

  /**
   * Creates a question response for a specific question in an assignment attempt.
   * @param assignmentAttemptId The ID of the assignment attempt.
   * @param questionId The ID of the question.
   * @param createQuestionResponseAttemptRequestDto The create request DTO.
   * @returns A create question response attempt response DTO.
   */
  async createQuestionResponse(
    assignmentAttemptId: number,
    questionId: number,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
    role: UserRole,
    authorQuestions?: QuestionDto[],
    assignmentDetails?: authorAssignmentDetailsDTO,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let question: QuestionDto;
    let assignmentContext: {
      assignmentInstructions: string;
      questionAnswerContext: QuestionAnswerContext[];
    };
    if (role === UserRole.LEARNER) {
      const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
        where: { id: assignmentAttemptId },
      });
      this.checkSubmissionDeadline(assignmentAttempt.expiresAt);
      question = await this.questionService.findOne(questionId);
      assignmentContext = await this.getAssignmentContext(
        assignmentAttempt.assignmentId,
        question.id,
        assignmentAttemptId,
        role,
      );
    } else if (role === UserRole.AUTHOR) {
      question = authorQuestions.find((q) => q.id === questionId);
      assignmentContext = {
        assignmentInstructions: assignmentDetails.instructions ?? "",
        questionAnswerContext: [],
      };
    }
    const { responseDto, learnerResponse } = await this.processQuestionResponse(
      question,
      createQuestionResponseAttemptRequestDto,
      assignmentContext,
    );
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentAttemptId:
          role === UserRole.LEARNER ? assignmentAttemptId : 1,
        questionId: questionId,
        learnerResponse: learnerResponse,
        points: responseDto.totalPoints,
        feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      },
    });

    responseDto.id = result.id;
    responseDto.questionId = questionId;
    responseDto.question = question.question;

    return responseDto;
  }

  // Private helper methods

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
              gte: new Date(), // Get any attempt that is not submitted and has not expired yet too (is in progress)
            },
          },
          {
            submitted: false,
            // eslint-disable-next-line unicorn/no-null
            expiresAt: null, // Get any attempt that is not submitted and has no expiry date (meaning time limit in unlimited)
          },
          {
            createdAt: {
              gte: timeRangeStartDate, // Get all attempt within the time range (for example within last 2 hours)
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
    if (assignment.numAttempts) {
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
    if (assignment.allotedTimeMinutes) {
      return new Date(Date.now() + assignment.allotedTimeMinutes * 60 * 1000);
    }
    return undefined;
  }

  /**
   * Validates whether the assignment attempt has expired.
   * @param expiresAt The expiration date of the assignment attempt.
   */
  private validateAssignmentAttemptExpiry(
    expiresAt: Date | null | undefined,
  ): void {
    const tenSecondsBeforeNow = new Date(Date.now() - 10 * 1000);
    if (expiresAt && tenSecondsBeforeNow > expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
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
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  }> {
    switch (question.type) {
      case QuestionType.TEXT:
      case QuestionType.UPLOAD: {
        return this.handleTextUploadQuestionResponse(
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
    );

    const model = await this.llmService.gradeTextBasedQuestion(
      textBasedQuestionEvaluateModel,
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

    const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
      question.question,
      assignmentContext.questionAnswerContext,
      assignmentContext.assignmentInstructions,
      learnerResponse,
      urlFetchResponse.isFunctional,
      urlFetchResponse.body,
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring?.criteria ?? {},
    );

    const model = await this.llmService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
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

    const correctAnswer = question.choices?.[0]?.choice === "true";
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
   * Handles single correct question responses.
   */
  private handleSingleCorrectQuestionResponse(
    question: QuestionDto,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): {
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string;
  } {
    const learnerChoice =
      createQuestionResponseAttemptRequestDto.learnerChoices[0];
    const correctChoice = question.choices?.find((choice) => choice.isCorrect);

    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (correctChoice && correctChoice.choice === learnerChoice) {
      responseDto.totalPoints = correctChoice.points;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: "Correct! You selected the right answer.",
        },
      ] as ChoiceBasedFeedbackDto[];
    } else {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: `Incorrect. The correct answer is: ${correctChoice?.choice}`,
        },
      ] as ChoiceBasedFeedbackDto[];
    }

    const learnerResponse = JSON.stringify([learnerChoice]);
    return { responseDto, learnerResponse };
  }

  /**
   * Handles multiple correct question responses.
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
          feedback: "You didn't select any option.",
        },
      ] as unknown as ChoiceBasedFeedbackDto[];
      const learnerResponse = JSON.stringify([]);
      return { responseDto, learnerResponse };
    }

    const learnerChoices =
      createQuestionResponseAttemptRequestDto.learnerChoices;
    const correctChoices =
      question.choices?.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) => choice.choice);
    let totalPoints = 0;
    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + choice.points,
      0,
    );
    const feedbackDetails: string[] = [];

    for (const learnerChoice of learnerChoices) {
      const selectedChoice = question.choices.find(
        (choice) => choice.choice === learnerChoice,
      );

      if (selectedChoice) {
        totalPoints += selectedChoice.points;
        if (selectedChoice.isCorrect) {
          feedbackDetails.push(
            `Correct selection: ${learnerChoice} (+${selectedChoice.points} points)`,
          );
        } else {
          feedbackDetails.push(
            `Incorrect selection: ${learnerChoice} (${selectedChoice.points} points)`,
          );
        }
      } else {
        feedbackDetails.push(`Invalid selection: ${learnerChoice} (0 points)`);
      }
    }

    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));
    const feedbackMessage = `
      ${feedbackDetails.join(". ")}.
      ${
        totalPoints < maxPoints ||
        !learnerChoices.every((choice) => correctChoiceTexts.includes(choice))
          ? `The correct option(s) were: ${correctChoiceTexts.join(", ")}.`
          : "You selected all correct options!"
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
   * Sorts the assignment questions based on the display order.
   * @param assignment The assignment object.
   */
  private sortAssignmentQuestions(
    assignment: LearnerGetAssignmentResponseDto,
  ): void {
    if (assignment.questions) {
      if (assignment.displayOrder === "RANDOM") {
        assignment.questions.sort(() => Math.random() - 0.5);
      } else if (assignment.questionOrder?.length > 0) {
        assignment.questions.sort(
          (a, b) =>
            assignment.questionOrder.indexOf(a.id) -
            assignment.questionOrder.indexOf(b.id),
        );
      }
    }
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

      const choices = question.choices
        ? (JSON.parse(JSON.stringify(question.choices)) as Choice[])
        : undefined;

      return {
        id: question.id,
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        maxCharacters: question.maxCharacters,
        type: question.type,
        question: question.question,
        choices: choices,
        assignmentId: question.assignmentId,
        alreadyInBackend: true,
        questionResponses: correspondingResponses,
      };
    });
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
