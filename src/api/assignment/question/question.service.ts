import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, QuestionType } from "@prisma/client";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { ChoiceBasedQuestionEvaluateModel } from "../../llm/model/choice.based.question.evaluate.model";
import { TextBasedQuestionEvaluateModel } from "../../llm/model/text.based.question.evaluate.model";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import {
  CreateUpdateQuestionRequestDto,
  Scoring,
} from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";
import { GradeQuestionRequestDto } from "./dto/grade.question.request.dto";
import { GradeQuestionResponseDto } from "./dto/grade.question.response.dto";
import { GradingHelper } from "./helper/grading.helper";

@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService
  ) {}

  async create(
    assignmentId: number,
    createQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(createQuestionRequestDto);
    const scoring = createQuestionRequestDto.scoring
      ? (createQuestionRequestDto.scoring as object)
      : undefined;
    const result = await this.prisma.question.create({
      data: {
        assignmentId: assignmentId,
        ...createQuestionRequestDto,
        scoring: scoring,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async findOne(id: number): Promise<GetQuestionResponseDto> {
    const result = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException(`Question with ID ${id} not found.`);
    }

    return {
      ...result,
      scoring: result.scoring
        ? (result.scoring as unknown as Scoring)
        : undefined,
      choices: result.choices
        ? (result.choices as Record<string, boolean>)
        : undefined,
      success: true,
    };
  }

  async update(
    assignmentId: number,
    id: number,
    updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(updateQuestionRequestDto);
    const scoring = (updateQuestionRequestDto.scoring as object) || undefined;
    const result = await this.prisma.question.update({
      where: { id },
      data: {
        assignmentId: assignmentId,
        ...updateQuestionRequestDto,
        scoring,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async replace(
    assignmentId: number,
    id: number,
    updateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(updateQuestionRequestDto);
    const scoring =
      (updateQuestionRequestDto.scoring as object) || Prisma.JsonNull;
    // eslint-disable-next-line unicorn/no-null
    const answer = updateQuestionRequestDto.answer || null;
    const choices = updateQuestionRequestDto.choices || Prisma.JsonNull;

    const result = await this.prisma.question.update({
      where: { id },
      data: {
        assignmentId,
        ...updateQuestionRequestDto,
        scoring,
        answer,
        choices,
      },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async remove(id: number): Promise<BaseQuestionResponseDto> {
    const result = await this.prisma.question.delete({
      where: { id },
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async gradeQuestion(
    id: number,
    gradeQuestionRequestDto: GradeQuestionRequestDto
  ): Promise<GradeQuestionResponseDto> {
    const question = await this.findOne(id);

    // Grade Text Based Questions
    if (
      question.type === QuestionType.TEXT ||
      question.type === QuestionType.UPLOAD ||
      question.type === QuestionType.URL
    ) {
      const textBasedQuestionEvaluateModel = new TextBasedQuestionEvaluateModel(
        question.question,
        gradeQuestionRequestDto.learnerResponse,
        question.totalPoints,
        question.scoring?.type ?? "",
        question.scoring?.criteria ?? {}
      );

      const models = await this.llmService.gradeTextBasedQuestion(
        textBasedQuestionEvaluateModel
      );

      // map from model to response DTO
      const dto = new GradeQuestionResponseDto();
      dto.totalPointsEarned = models.reduce(
        (sum, model) => sum + model.points,
        0
      );
      dto.feedback = models.map((element) =>
        GradingHelper.toTextBasedFeedbackDto(element)
      );
      return dto;
    }

    //Grade Choice Based Questions
    else {
      const choiceBasedQuestionEvaluateModel =
        new ChoiceBasedQuestionEvaluateModel(
          question.question,
          question.choices ?? {},
          gradeQuestionRequestDto.learnerChoices,
          question.totalPoints,
          question.scoring?.type,
          question.scoring?.criteria ?? undefined
        );

      const model = await this.llmService.gradeChoiceBasedQuestion(
        choiceBasedQuestionEvaluateModel
      );

      // map from model to respons DTO
      const dto = new GradeQuestionResponseDto();
      dto.totalPointsEarned = model.points;
      dto.feedback = model.feedback;
      return dto;
    }
  }

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto
  ): Promise<void> {
    const guardRailsValidation = await this.llmService.applyGuardRails(
      JSON.stringify(createUpdateQuestionRequestDto)
    );
    if (!guardRailsValidation) {
      throw new HttpException(
        "Question validation failed due to inappropriate or unacceptable content",
        HttpStatus.BAD_REQUEST
      );
    }
  }
}
