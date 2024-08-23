import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { QuestionResponse, QuestionType } from "@prisma/client";
import { QuestionAnswerContext } from "../../../api/llm/model/base.question.evaluate.model";
import { TrueFalseBasedQuestionEvaluateModel } from "../../../api/llm/model/true.false.based.question.evaluate.model";
import { UrlBasedQuestionEvaluateModel } from "../../../api/llm/model/url.based.question.evaluate.model";
import {
  UserRole,
  UserSession,
} from "../../../auth/interfaces/user.session.interface";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { ChoiceBasedQuestionEvaluateModel } from "../../llm/model/choice.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { AssignmentService } from "../assignment.service";
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
import { LearnerUpdateAssignmentAttemptRequestDto } from "./dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import {
  AssignmentAttemptResponseDto,
  GetAssignmentAttemptResponseDto,
} from "./dto/assignment-attempt/get.assignment.attempt.response.dto";
import { UpdateAssignmentAttemptResponseDto } from "./dto/assignment-attempt/update.assignment.attempt.response.dto";
import { CreateQuestionResponseAttemptRequestDto } from "./dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "./dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "./helper/attempts.helper";

@Injectable()
export class AttemptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService,
    private readonly httpService: HttpService,
  ) {}

  async listAssignmentAttempts(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<AssignmentAttemptResponseDto[]> {
    //correct ownership permissions already taken care of through AssignmentAttemptAccessControlGuard
    return userSession.role === UserRole.AUTHOR
      ? this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignmentId },
        })
      : this.prisma.assignmentAttempt.findMany({
          where: { assignmentId: assignmentId, userId: userSession.userId },
        });
  }

  async createAssignmentAttempt(
    assignmentId: number,
    userSession: UserSession,
  ): Promise<BaseAssignmentAttemptResponseDto> {
    // Check if any of the existing attempts is in progress and has not expired and user is allowed to start a new attempt, otherwise return exception
    const assignment = await this.assignmentService.findOne(
      assignmentId,
      userSession,
    );

    // Calculate the start date of the time range.
    let timeRangeStartDate = new Date();
    if (assignment.attemptsTimeRangeHours) {
      timeRangeStartDate = new Date(
        Date.now() - assignment.attemptsTimeRangeHours * 60 * 60 * 1000,
      ); // Convert hours to milliseconds
    }

    const attempts = await this.prisma.assignmentAttempt.findMany({
      where: {
        userId: userSession.userId,
        assignmentId: assignmentId,
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

    // Separate the attempts based on ongoing and within the time range
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

    //Get exising attempts count to check if new attempt is possible
    if (assignment.numAttempts) {
      //if null then assume unlimited attempts
      const attemptCount = await this.countUserAttempts(
        userSession.userId,
        assignmentId,
      );

      if (attemptCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
        );
      }
    }

    // eslint-disable-next-line unicorn/no-null
    let attemptExpiresAt: Date | null = null;
    if (assignment.allotedTimeMinutes) {
      const currentDate = new Date();
      attemptExpiresAt = new Date(
        currentDate.getTime() + assignment.allotedTimeMinutes * 60 * 1000,
      );
    }

    const result = await this.prisma.assignmentAttempt.create({
      data: {
        expiresAt: attemptExpiresAt,
        submitted: false,
        assignmentId: assignmentId,
        // eslint-disable-next-line unicorn/no-null
        grade: null,
        userId: userSession.userId,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async updateAssignmentAttempt(
    assignmentAttemptId: number,
    assignmentId: number,
    updateAssignmentAttemptDto: LearnerUpdateAssignmentAttemptRequestDto,
    authCookie: string,
    gradingCallbackRequired: boolean,
  ): Promise<UpdateAssignmentAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
    });

    // Have some buffer time so that submissions right at the deadline are accepted
    const tenSecondsBeforeSubmission = new Date(Date.now() - 10 * 1000);
    if (
      assignmentAttempt.expiresAt &&
      tenSecondsBeforeSubmission > assignmentAttempt.expiresAt
    ) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { questions: true },
    });

    // Submit all the questions in the assignment
    const questionResponsesPromise =
      updateAssignmentAttemptDto.responsesForQuestions.map(
        async (questionResponse) => {
          const { id: questionId, ...cleanedQuestionResponse } =
            questionResponse;
          return await this.createQuestionResponse(
            assignmentAttemptId,
            questionId,
            cleanedQuestionResponse,
          );
        },
      );

    const questionResponses = await Promise.allSettled(
      questionResponsesPromise,
    );
    const successfulQuestionResponseSubmissions = questionResponses
      .filter((response) => response.status === "fulfilled")
      .map((response) => response.value);

    const failedQuestionResponseSubmissions = questionResponses
      .filter((response) => response.status === "rejected")
      .map((response) => response.reason as string);

    if (failedQuestionResponseSubmissions.length > 0) {
      // Handle the error according to your needs
      throw new InternalServerErrorException(
        `Failed to submit questions: ${failedQuestionResponseSubmissions
          .map((response) => response)
          .join(", ")}`,
      );
    }

    let grade: number;

    if (updateAssignmentAttemptDto.responsesForQuestions.length === 0) {
      grade = 0;
    } else {
      const totalPointsEarned = successfulQuestionResponseSubmissions.reduce(
        (accumulator, response) => accumulator + response.totalPoints,
        0,
      );

      // Calculate grade and sent back to lms
      let totalPossiblePoints = 0;
      for (const question of assignment.questions) {
        totalPossiblePoints += question.totalPoints;
      }
      grade = totalPointsEarned / totalPossiblePoints;
    }
    // Send the grade to LTI gateway (optional)
    if (gradingCallbackRequired) {
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

      // Checking if the request was successful
      if (ltiGatewayResponse.status !== 200) {
        // Handle the error according to your needs
        throw new InternalServerErrorException(GRADE_SUBMISSION_EXCEPTION);
      }
    }

    const { responsesForQuestions: _, ...cleanedUpdateAssignmentAttemptDto } =
      updateAssignmentAttemptDto;
    // Update AssignmentAttempt with the calculated grade
    const result = await this.prisma.assignmentAttempt.update({
      data: {
        ...cleanedUpdateAssignmentAttemptDto,
        grade,
      },
      where: { id: assignmentAttemptId },
    });

    return {
      id: result.id,
      submitted: result.submitted,
      success: true,
      grade: assignment.showAssignmentScore ? result.grade : undefined,
      feedbacksForQuestions: assignment.showSubmissionFeedback
        ? successfulQuestionResponseSubmissions
        : undefined,
    };
  }

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
      },
    });

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

    const questions = assignment.questions.map((question) => {
      const correspondingResponses = assignmentAttempt.questionResponses.filter(
        (response) => response.questionId === question.id,
      );

      const choices = question.choices
        ? (JSON.parse(JSON.stringify(question.choices)) as Choice[])
        : undefined;

      return {
        id: question.id,
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        type: question.type,
        question: question.question,
        choices: choices,
        questionResponses:
          correspondingResponses.length > 0 ? correspondingResponses : [],
      };
    });

    delete assignmentAttempt.questionResponses;

    return {
      ...assignmentAttempt,
      questions: questions,
    };
  }

  async createQuestionResponse(
    assignmentAttemptId: number,
    questionId: number,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    const assignmentAttempt = await this.prisma.assignmentAttempt.findUnique({
      where: { id: assignmentAttemptId },
    });

    // Have some buffer time so that submissions right at the deadline are accepted
    const thirtySecondsBeforeSubmission = new Date(Date.now() - 30 * 1000);
    if (
      assignmentAttempt.expiresAt &&
      thirtySecondsBeforeSubmission > assignmentAttempt.expiresAt
    ) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
      );
    }

    const question = await this.questionService.findOne(questionId);
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentAttempt.assignmentId },
    });

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    let learnerResponse: string;

    const assignmentContext = await this.getAssignmentContext(
      assignmentAttempt.assignmentId,
      question.id,
      assignmentAttemptId,
    );

    switch (question.type) {
      case QuestionType.TEXT:
      case QuestionType.UPLOAD: {
        learnerResponse = await AttemptHelper.validateAndGetTextResponse(
          question.type,
          createQuestionResponseAttemptRequestDto,
        );
        const textBasedQuestionEvaluateModel =
          new TextBasedQuestionEvaluateModel(
            question.question,
            assignmentContext.questionAnswerContext,
            assignmentContext.assignmentInstructions,
            learnerResponse,
            question.totalPoints,
            question.scoring?.type ?? "",
            question.scoring?.criteria ?? {},
          );
        const model = await this.llmService.gradeTextBasedQuestion(
          textBasedQuestionEvaluateModel,
        );
        AttemptHelper.assignFeedbackToResponse(model, responseDto);
        break;
      }
      case QuestionType.URL: {
        if (!createQuestionResponseAttemptRequestDto.learnerUrlResponse) {
          throw new BadRequestException(
            "Expected a url-based response (learnerUrlResponse), but did not receive one.",
          );
        }
        const urlFetchResponse = await AttemptHelper.fetchPlainTextFromUrl(
          createQuestionResponseAttemptRequestDto.learnerUrlResponse,
        );
        const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
          question.question,
          assignmentContext.questionAnswerContext,
          assignmentContext.assignmentInstructions,
          createQuestionResponseAttemptRequestDto.learnerUrlResponse,
          urlFetchResponse.isFunctional,
          urlFetchResponse.body,
          question.totalPoints,
          question.scoring?.type ?? "",
          question.scoring?.criteria ?? {},
        );
        const model = await this.llmService.gradeUrlBasedQuestion(
          urlBasedQuestionEvaluateModel,
        );
        AttemptHelper.assignFeedbackToResponse(model, responseDto);
        learnerResponse =
          createQuestionResponseAttemptRequestDto.learnerUrlResponse;
        break;
      }
      case QuestionType.TRUE_FALSE: {
        if (
          createQuestionResponseAttemptRequestDto.learnerAnswerChoice ===
            null ||
          createQuestionResponseAttemptRequestDto.learnerAnswerChoice ===
            undefined
        ) {
          throw new BadRequestException(
            "Expected a true-false-based response (learnerAnswerChoice), but did not receive one.",
          );
        }
        const trueFalseBasedQuestionEvaluateModel =
          new TrueFalseBasedQuestionEvaluateModel(
            question.question,
            assignmentContext.questionAnswerContext,
            assignmentContext.assignmentInstructions,
            question.answer,
            createQuestionResponseAttemptRequestDto.learnerAnswerChoice,
            question.totalPoints,
          );
        const model = await this.llmService.gradeTrueFalseBasedQuestion(
          trueFalseBasedQuestionEvaluateModel,
        );
        AttemptHelper.assignFeedbackToResponse(model, responseDto);
        learnerResponse = JSON.stringify(
          createQuestionResponseAttemptRequestDto.learnerAnswerChoice,
        );
        break;
      }
      case QuestionType.SINGLE_CORRECT:
      case QuestionType.MULTIPLE_CORRECT: {
        if (!createQuestionResponseAttemptRequestDto.learnerChoices) {
          throw new BadRequestException(
            "Expected a choice-based response (learnerChoices), but did not receive one.",
          );
        }
        const choiceBasedQuestionEvaluateModel =
          new ChoiceBasedQuestionEvaluateModel(
            question.question,
            assignmentContext.questionAnswerContext,
            assignmentContext.assignmentInstructions,
            question.choices ?? [],
            createQuestionResponseAttemptRequestDto.learnerChoices,
            question.totalPoints,
            question.scoring?.type,
            question.scoring?.criteria ?? undefined,
          );
        const model = await this.llmService.gradeChoiceBasedQuestion(
          choiceBasedQuestionEvaluateModel,
        );
        AttemptHelper.assignFeedbackToResponse(model, responseDto);
        learnerResponse = JSON.stringify(
          createQuestionResponseAttemptRequestDto.learnerChoices,
        );
        break;
      }
      default: {
        throw new Error("Invalid question type provided.");
      }
    }

    // create a question response record in db
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentAttemptId: assignmentAttemptId,
        questionId: questionId,
        learnerResponse: learnerResponse,
        points: responseDto.totalPoints,
        feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      },
    });

    responseDto.id = result.id;
    responseDto.questionId = questionId;
    responseDto.question = question.question;
    if (!assignment.showQuestionScore) {
      delete responseDto.totalPoints;
    }
    if (!assignment.showSubmissionFeedback) {
      delete responseDto.feedback;
    }
    return responseDto;
  }

  // private methods

  async countUserAttempts(
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

  async countUserQuestionResponses(
    questionId: number,
    assignmentAttemptId: number,
  ): Promise<number> {
    return this.prisma.questionResponse.count({
      where: {
        questionId: questionId,
        assignmentAttemptId: assignmentAttemptId,
      },
    });
  }

  async getAssignmentContext(
    assignmentId: number,
    questionId: number,
    assignmentAttemptId: number,
  ): Promise<{
    assignmentInstructions: string;
    questionAnswerContext: QuestionAnswerContext[];
  }> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentId },
      select: { instructions: true },
    });

    // 1. Fetch the gradingContextQuestionIds for the given question.
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
      select: { gradingContextQuestionIds: true },
    });

    if (!question) {
      throw new Error("Question not found.");
    }

    // 2. Using the fetched gradingContextQuestionIds, retrieve all those questions.
    const contextQuestions = await this.prisma.question.findMany({
      where: {
        id: {
          in: question.gradingContextQuestionIds,
        },
      },
      select: { id: true, question: true, type: true },
    });

    // 3. Fetch all responses for the context questions at once.
    const allResponses = await this.prisma.questionResponse.findMany({
      where: {
        assignmentAttemptId: assignmentAttemptId,
        questionId: {
          in: question.gradingContextQuestionIds,
        },
      },
      orderBy: {
        id: "desc", // This ensures that the latest responses come first.
      },
    });

    // Group responses by questionId to quickly look up the latest response for each question.
    const groupedResponses: { [key: number]: QuestionResponse } = {};

    for (const response of allResponses) {
      if (!groupedResponses[response.questionId]) {
        groupedResponses[response.questionId] = response; // store the latest response (since we ordered them in descending order)
      }
    }

    // 4. Construct the QuestionAnswerContext model array with the added functionality.
    const questionsAnswersContext: QuestionAnswerContext[] = [];
    for (const contextQuestion of contextQuestions) {
      let learnerResponse =
        groupedResponses[contextQuestion.id]?.learnerResponse || "";

      // Check if the question type is URL and then fetch plain text from the URL.
      if (contextQuestion.type === "URL" && learnerResponse) {
        const urlContent =
          await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
        learnerResponse = JSON.stringify({
          url: learnerResponse,
          ...urlContent,
        });
      }

      questionsAnswersContext.push({
        question: contextQuestion.question,
        answer: learnerResponse,
      });
    }

    // 5. Return the assignment instructions and the QuestionAnswerContext array.
    return {
      assignmentInstructions: assignment?.instructions || "",
      questionAnswerContext: questionsAnswersContext,
    };
  }
}
