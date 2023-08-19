import {
  BadRequestException,
  Injectable,
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
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import {
  AdminCreateUpdateAssignmentSubmissionRequestDto,
  LearnerUpdateAssignmentSubmissionRequestDto,
} from "./dto/assignment-submission/create.update.assignment.submission.request.dto";
import { GetAssignmentSubmissionResponseDto } from "./dto/assignment-submission/get.assignment.submission.response.dto";
import { UpdateAssignmentSubmissionResponseDto } from "./dto/assignment-submission/update.assignment.submission.response.dto";
import { CreateQuestionResponseSubmissionRequestDto } from "./dto/question-response/create.question.response.submission.request.dto";
import { CreateQuestionResponseSubmissionResponseDto } from "./dto/question-response/create.question.response.submission.response.dto";
import { GetAssignmentSubmissionQuestionResponseDto } from "./dto/question/get.assignment.submission.questions.response.dto";
import { GradingHelper } from "./helper/grading.helper";

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService,
    private readonly assignmentService: AssignmentService
  ) {}

  async createAssignmentSubmission(
    assignmentID: number,
    user: User,
    adminCreateUpdateAssignmentSubmissionRequestDto?: AdminCreateUpdateAssignmentSubmissionRequestDto
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    const userRole = user.role;

    // Get assignment's allotedTime to calculate expiry for the submission and check for numAttempts
    const assignment = await this.assignmentService.findOne(assignmentID, user);

    //Get exising submissions count to check if new attempt is possible
    if (assignment.numAttempts) {
      const submissionCount = await this.countUserSubmissions(
        user.userID,
        assignmentID
      );

      if (submissionCount >= assignment.numAttempts) {
        throw new UnprocessableEntityException(
          "Maximum number of attempts reached for this assignment"
        );
      }
    }

    // eslint-disable-next-line unicorn/no-null
    let submissionExpiry: Date | null = null;
    if (assignment.allotedTime) {
      const currentDate = new Date();
      submissionExpiry = new Date(
        currentDate.getTime() + assignment.allotedTime * 60 * 1000
      );
    }

    let submissionData = {
      expiry: submissionExpiry,
      submitted: false,
      assignmentId: assignmentID,
      // eslint-disable-next-line unicorn/no-null
      grade: null,
      userId: user.userID,
    };

    if (userRole === UserRole.ADMIN) {
      // Merge the default properties with the provided Admin DTO
      submissionData = {
        ...submissionData,
        ...adminCreateUpdateAssignmentSubmissionRequestDto,
      };
    }

    const result = await this.prisma.assignmentSubmission.create({
      data: submissionData,
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async updateAssignmentSubmission(
    assignmentSubmissionID: number,
    assignmentID: number,
    userRole: UserRole,
    updateAssignmentSubmissionDto:
      | LearnerUpdateAssignmentSubmissionRequestDto
      | AdminCreateUpdateAssignmentSubmissionRequestDto
  ): Promise<UpdateAssignmentSubmissionResponseDto> {
    if (userRole === UserRole.ADMIN) {
      const result = await this.prisma.assignmentSubmission.update({
        data: updateAssignmentSubmissionDto,
        where: { id: assignmentSubmissionID },
      });

      return {
        id: result.id,
        grade: result.grade,
        submitted: result.submitted,
        success: true,
      };
    }

    const assignmentSubmission =
      await this.prisma.assignmentSubmission.findUnique({
        where: { id: assignmentSubmissionID },
      });

    if (new Date() > assignmentSubmission.expiry) {
      throw new BadRequestException("The submission deadline has passed.");
    }

    // If the role is learner, we only allow submitted to be true, then means now calculate grade and sent back to lms
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

    // Update AssignmentSubmission with the calculated grade
    const result = await this.prisma.assignmentSubmission.update({
      data: {
        ...updateAssignmentSubmissionDto,
        grade,
      },
      where: { id: assignmentSubmissionID },
    });

    // Send the grade to LTI gateway
    // const ltiGatewayResponse = await this.httpService
    //   .post('/lti-gateway/submit-grade', {
    //     userId: result.userId,
    //     grade,
    //   })
    //   .toPromise();

    // // Checking if the request was successful
    // if (ltiGatewayResponse.status !== 200) {
    //   // Handle the error according to your needs
    //   throw new Error('Failed to submit grade to LTI Gateway');
    // }

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

    return {
      ...result,
      success: true,
    };
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

  // async listAssignmentSubmissions(userRole:UserRole): Promise<GetAssignmentSubmissionResponseDto>{
  //   if(userRole===UserRole.ADMIN){

  //   }
  // }

  async createQuestionResponse(
    assignmentSubmissionID: number,
    questionID: number,
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<CreateQuestionResponseSubmissionResponseDto> {
    const question = await this.questionService.findOne(questionID);

    //Get exising question respones count to check if new response is possible
    if (question.numRetries) {
      const retryCount = await this.countUserQuestionResponses(
        questionID,
        assignmentSubmissionID
      );

      if (retryCount >= question.numRetries) {
        throw new UnprocessableEntityException(
          "Maximum number of retries attempted for this question."
        );
      }
    }

    const responseDto = new CreateQuestionResponseSubmissionResponseDto();
    let learnerResponse;
    // Grade Text Based Questions
    if (
      question.type === QuestionType.TEXT ||
      question.type === QuestionType.UPLOAD ||
      question.type === QuestionType.URL
    ) {
      if (!createQuestionResponseSubmissionRequestDto.learnerResponse) {
        throw new BadRequestException(
          "Expected a text-based response (learnerResponse), but did not receive one."
        );
      }

      const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
        question.question,
        createQuestionResponseSubmissionRequestDto.learnerResponse,
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
        GradingHelper.toTextBasedFeedbackDto(element)
      );
      learnerResponse =
        createQuestionResponseSubmissionRequestDto.learnerResponse;
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
    responseDto.success = true;
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
