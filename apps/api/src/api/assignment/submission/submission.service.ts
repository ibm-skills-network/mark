import { HttpService } from "@nestjs/axios";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { TrueFalseBasedQuestionEvaluateModel } from "../../../api/llm/model/true.false.based.question.evaluate.model";
import { User, UserRole } from "../../../auth/interfaces/user.interface";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { ChoiceBasedQuestionEvaluateModel } from "../../llm/model/choice.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { AssignmentService } from "../assignment.service";
import { QuestionService } from "../question/question.service";
import {
  GRADE_SUBMISSION_EXCEPTION,
  IN_PROGRESS_SUBMISSION_EXCEPTION,
  MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
  MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE,
  SUBMISSION_DEADLINE_EXCEPTION_MESSAGE,
  TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE,
} from "./api-exceptions/exceptions";
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import { LearnerUpdateAssignmentSubmissionRequestDto } from "./dto/assignment-submission/create.update.assignment.submission.request.dto";
import {
  AssignmentSubmissionResponseDto,
  GetAssignmentSubmissionResponseDto,
} from "./dto/assignment-submission/get.assignment.submission.response.dto";
import { UpdateAssignmentSubmissionResponseDto } from "./dto/assignment-submission/update.assignment.submission.response.dto";
import { CreateQuestionResponseSubmissionRequestDto } from "./dto/question-response/create.question.response.submission.request.dto";
import { CreateQuestionResponseSubmissionResponseDto } from "./dto/question-response/create.question.response.submission.response.dto";
import { GetAssignmentSubmissionQuestionResponseDto } from "./dto/question/get.assignment.submission.questions.response.dto";
import { SubmissionHelper } from "./helper/submission.helper";

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService,
    private readonly httpService: HttpService
  ) {}

  async listAssignmentSubmissions(
    assignmentID: number,
    user: User
  ): Promise<AssignmentSubmissionResponseDto[]> {
    //correct ownership permissions already taken care of through AssignmentSubmissionAccessControlGuard
    const results = await (user.role === UserRole.AUTHOR
      ? this.prisma.assignmentSubmission.findMany({
          where: { assignmentId: assignmentID },
        })
      : this.prisma.assignmentSubmission.findMany({
          where: { assignmentId: assignmentID, userId: user.userID },
        }));
    return results;
  }

  async createAssignmentSubmission(
    assignmentID: number,
    user: User
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    // Check if any of the existing submissions is in progress and has not expired and user is allowed to start a new submission, otherwise return exception

    const assignment = await this.assignmentService.findOne(assignmentID, user);

    // Calculate the start date of the time range.
    let timeRangeStartDate = new Date();
    if (assignment.attemptsTimeRangeHours) {
      timeRangeStartDate = new Date(
        Date.now() - assignment.attemptsTimeRangeHours * 60 * 60 * 1000
      ); // Convert hours to milliseconds
    }

    const submissions = await this.prisma.assignmentSubmission.findMany({
      where: {
        userId: user.userID,
        assignmentId: assignmentID,
        OR: [
          {
            submitted: false,
            expiresAt: {
              gte: new Date(), // Get any submission that is not submitted and has not expired yet too (is in progress)
            },
          },
          {
            createdAt: {
              gte: timeRangeStartDate, // Get all submission within the time range (for example within last 2 hours)
              lte: new Date(),
            },
          },
        ],
      },
    });

    // Separate the submissions based on ongoing and within the time range
    const ongoingSubmissions = submissions.filter(
      (sub) => !sub.submitted && sub.expiresAt >= new Date()
    );

    const submissionsInTimeRange = submissions.filter(
      (sub) =>
        sub.createdAt >= timeRangeStartDate && sub.createdAt <= new Date()
    );

    if (ongoingSubmissions.length > 0) {
      throw new UnprocessableEntityException(IN_PROGRESS_SUBMISSION_EXCEPTION);
    }

    if (
      assignment.attemptsPerTimeRange &&
      submissionsInTimeRange.length >= assignment.attemptsPerTimeRange
    ) {
      throw new UnprocessableEntityException(
        TIME_RANGE_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE
      );
    }

    //Get exising submissions count to check if new attempt is possible
    if (assignment.numAttempts) {
      //if null then assume unlimited attempts
      const submissionCount = await this.countUserSubmissions(
        user.userID,
        assignmentID
      );

      if (submissionCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          MAX_ATTEMPTS_SUBMISSION_EXCEPTION_MESSAGE
        );
      }
    }

    // eslint-disable-next-line unicorn/no-null
    let submissionexpiresAt: Date | null = null;
    if (assignment.allotedTimeMinutes) {
      const currentDate = new Date();
      submissionexpiresAt = new Date(
        currentDate.getTime() + assignment.allotedTimeMinutes * 60 * 1000
      );
    }

    const result = await this.prisma.assignmentSubmission.create({
      data: {
        expiresAt: submissionexpiresAt,
        submitted: false,
        assignmentId: assignmentID,
        // eslint-disable-next-line unicorn/no-null
        grade: null,
        userId: user.userID,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async updateAssignmentSubmission(
    assignmentSubmissionID: number,
    assignmentID: number,
    updateAssignmentSubmissionDto: LearnerUpdateAssignmentSubmissionRequestDto,
    authCookie: string
  ): Promise<UpdateAssignmentSubmissionResponseDto> {
    const assignmentSubmission =
      await this.prisma.assignmentSubmission.findUnique({
        where: { id: assignmentSubmissionID },
      });

    if (new Date() > assignmentSubmission.expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE
      );
    }

    // Calculate grade and sent back to lms
    let grade = 0;

    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentID },
      include: { questions: true },
    });

    let totalPossiblePoints = 0;
    for (const question of assignment.questions) {
      totalPossiblePoints += question.totalPoints;
    }

    const questionResponses = await this.prisma.questionResponse.findMany({
      where: { assignmentSubmissionId: assignmentSubmissionID },
    });

    // Map to store the highest score for each question
    const questionIDToHighestScoreMap: { [key: string]: number } = {};

    for (const response of questionResponses) {
      if (
        !questionIDToHighestScoreMap[response.questionId] ||
        response.points > questionIDToHighestScoreMap[response.questionId]
      ) {
        questionIDToHighestScoreMap[response.questionId] = response.points;
      }
    }

    const totalPointsEarned = Object.values(questionIDToHighestScoreMap).reduce(
      (sum: number, points: number) => {
        return sum + points;
      },
      0
    );

    grade = totalPointsEarned / totalPossiblePoints;

    // Send the grade to LTI gateway
    const ltiGatewayResponse = await this.httpService
      .post(
        process.env.GRADING_LTI_GATEWAY_URL,
        { score: grade },
        {
          headers: {
            Cookie: `authentication=${authCookie}`,
          },
        }
      )
      .toPromise();

    // Checking if the request was successful
    if (ltiGatewayResponse.status !== 200) {
      // Handle the error according to your needs
      throw new InternalServerErrorException(GRADE_SUBMISSION_EXCEPTION);
    }

    // Update AssignmentSubmission with the calculated grade
    const result = await this.prisma.assignmentSubmission.update({
      data: {
        ...updateAssignmentSubmissionDto,
        grade,
      },
      where: { id: assignmentSubmissionID },
    });

    return {
      id: result.id,
      grade: result.grade,
      submitted: result.submitted,
      success: true,
    };
  }

  async getAssignmentSubmission(
    assignmentSubmissionID: number
  ): Promise<GetAssignmentSubmissionResponseDto> {
    const result = await this.prisma.assignmentSubmission.findUnique({
      where: { id: assignmentSubmissionID },
      include: { questionResponses: true },
    });

    if (!result) {
      throw new NotFoundException(
        `AssignmentSubmission with ID ${assignmentSubmissionID} not found.`
      );
    }

    return result;
  }

  async getAssignmentSubmissionQuestions(
    assignmentID: number
  ): Promise<GetAssignmentSubmissionQuestionResponseDto[]> {
    const assignment = await this.prisma.assignment.findUnique({
      where: { id: assignmentID },
      include: { questions: true },
    });

    return assignment.questions.map((question) => ({
      id: question.id,
      totalPoints: question.totalPoints,
      numRetries: question.numRetries,
      type: question.type,
      question: question.question,
      choices: question.choices ? Object.keys(question.choices) : undefined,
      success: true,
    }));
  }

  async createQuestionResponse(
    assignmentSubmissionID: number,
    questionID: number,
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<CreateQuestionResponseSubmissionResponseDto> {
    const assignmentSubmission =
      await this.prisma.assignmentSubmission.findUnique({
        where: { id: assignmentSubmissionID },
      });

    if (new Date() > assignmentSubmission.expiresAt) {
      throw new UnprocessableEntityException(
        SUBMISSION_DEADLINE_EXCEPTION_MESSAGE
      );
    }

    const question = await this.questionService.findOne(questionID);

    //Get exising question respones count to check if new response is possible
    if (question.numRetries) {
      const retryCount = await this.countUserQuestionResponses(
        questionID,
        assignmentSubmissionID
      );

      if (retryCount >= question.numRetries) {
        throw new UnprocessableEntityException(
          MAX_RETRIES_QUESTION_EXCEPTION_MESSAGE
        );
      }
    }

    const responseDto = new CreateQuestionResponseSubmissionResponseDto();
    let learnerResponse: string;
    // Grade Text Based Questions
    if (
      question.type === QuestionType.TEXT ||
      question.type === QuestionType.UPLOAD ||
      question.type === QuestionType.URL
    ) {
      learnerResponse = await SubmissionHelper.validateAndGetTextResponse(
        question.type,
        createQuestionResponseSubmissionRequestDto
      );

      const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
        question.question,
        learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring?.criteria ?? {}
      );

      const models = await this.llmService.gradeTextBasedQuestion(
        textBasedQuestionEvaluateModel
      );

      // map from model to response DTO
      responseDto.totalPoints = models.reduce(
        (sum, model) => sum + model.points,
        0
      );
      responseDto.feedback = models.map((element) =>
        SubmissionHelper.toTextBasedFeedbackDto(element)
      );
    }

    // Grade True False Questions
    else if (question.type === QuestionType.TRUE_FALSE) {
      if (!createQuestionResponseSubmissionRequestDto.learnerAnswerChoice) {
        throw new BadRequestException(
          "Expected a true-false-based response (learnerAnswerChoice), but did not receive one."
        );
      }

      const trueFalseBasedQuestionEvaluateModel =
        new TrueFalseBasedQuestionEvaluateModel(
          question.question,
          question.answer,
          createQuestionResponseSubmissionRequestDto.learnerAnswerChoice,
          question.totalPoints
        );

      const model = await this.llmService.gradeTrueFalseBasedQuestion(
        trueFalseBasedQuestionEvaluateModel
      );

      // map from model to respons DTO
      responseDto.totalPoints = model.points;
      responseDto.feedback = model.feedback;
      learnerResponse = JSON.stringify(
        createQuestionResponseSubmissionRequestDto.learnerAnswerChoice
      );
    }

    //Grade Choice Based Questions
    else {
      if (!createQuestionResponseSubmissionRequestDto.learnerChoices) {
        throw new BadRequestException(
          "Expected a choice-based response (learnerChoices), but did not receive one."
        );
      }

      const choiceBasedQuestionEvaluateModel =
        new ChoiceBasedQuestionEvaluateModel(
          question.question,
          question.choices ?? {},
          createQuestionResponseSubmissionRequestDto.learnerChoices,
          question.totalPoints,
          question.scoring?.type,
          question.scoring?.criteria ?? undefined
        );

      const model = await this.llmService.gradeChoiceBasedQuestion(
        choiceBasedQuestionEvaluateModel
      );

      // map from model to respons DTO
      responseDto.totalPoints = model.points;
      responseDto.feedback = model.feedback;
      learnerResponse = JSON.stringify(
        createQuestionResponseSubmissionRequestDto.learnerChoices
      );
    }

    // create a question response record in db
    const result = await this.prisma.questionResponse.create({
      data: {
        assignmentSubmissionId: assignmentSubmissionID,
        questionId: questionID,
        learnerResponse: learnerResponse,
        points: responseDto.totalPoints,
        feedback: JSON.parse(JSON.stringify(responseDto.feedback)) as object,
      },
    });

    responseDto.id = result.id;
    return responseDto;
  }

  // private methods

  async countUserSubmissions(
    userID: string,
    assignmentId: number
  ): Promise<number> {
    return this.prisma.assignmentSubmission.count({
      where: {
        userId: userID,
        assignmentId: assignmentId,
      },
    });
  }

  async countUserQuestionResponses(
    questionID: number,
    assignmentSubmissionID: number
  ): Promise<number> {
    return this.prisma.questionResponse.count({
      where: {
        questionId: questionID,
        assignmentSubmissionId: assignmentSubmissionID,
      },
    });
  }
}
