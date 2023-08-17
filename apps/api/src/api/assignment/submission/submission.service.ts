import { Injectable, NotFoundException } from "@nestjs/common";
import {
  AssignmentSubmissionState,
  Prisma,
  QuestionType,
} from "@prisma/client";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { ChoiceBasedQuestionEvaluateModel } from "../../llm/model/choice.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { QuestionService } from "../question/question.service";
import { BaseAssignmentSubmissionResponseDto } from "./dto/assignment-submission/base.assignment.submission.response.dto";
import { GetAssignmentSubmissionResponseDto } from "./dto/assignment-submission/get.assignment.submission.response.dto";
import { CreateQuestionResponseSubmissionRequestDto } from "./dto/question-response/create.question.response.submission.request.dto";
import { CreateQuestionResponseSubmissionResponseDto } from "./dto/question-response/create.question.response.submission.response.dto";
import { GradingHelper } from "./helper/grading.helper";

@Injectable()
export class SubmissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly questionService: QuestionService
  ) {}

  async createAssignmentSubmission(
    assignmentID: number
  ): Promise<BaseAssignmentSubmissionResponseDto> {
    const result = await this.prisma.assignmentSubmission.create({
      data: {
        state: AssignmentSubmissionState.IN_PROGRESS,
        assignmentId: assignmentID,
      },
    });

    return {
      id: result.id,
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

  async createQuestionResponse(
    assignmentSubmissionID: number,
    questionID: number,
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<CreateQuestionResponseSubmissionResponseDto> {
    const question = await this.questionService.findOne(questionID);

    // Check if the questionID specified actually belongs to the assignment specified and

    const responseDto = new CreateQuestionResponseSubmissionResponseDto();
    let learnerResponse;
    // Grade Text Based Questions
    if (
      question.type === QuestionType.TEXT ||
      question.type === QuestionType.UPLOAD ||
      question.type === QuestionType.URL
    ) {
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

    //Grade Choice Based Questions
    else {
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
}
