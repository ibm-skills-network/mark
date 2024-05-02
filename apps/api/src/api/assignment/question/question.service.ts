import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import {
  Choice,
  CreateUpdateQuestionRequestDto,
  Scoring,
} from "./dto/create.update.question.request.dto";
import { GetQuestionResponseDto } from "./dto/get.question.response.dto";

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
    const choices = createQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(createQuestionRequestDto.choices)
        ) as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    const result = await this.prisma.question.create({
      data: {
        assignmentId: assignmentId,
        ...createQuestionRequestDto,
        scoring,
        choices,
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
      throw new NotFoundException(`Question with Id ${id} not found.`);
    }

    return {
      ...result,
      scoring: result.scoring
        ? (result.scoring as unknown as Scoring)
        : undefined,
      choices: result.choices
        ? (result.choices as unknown as Choice[])
        : undefined,
      assignmentId: result.assignmentId,
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
    const choices = updateQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(updateQuestionRequestDto.choices)
        ) as Prisma.InputJsonValue)
      : Prisma.JsonNull;
    const result = await this.prisma.question.update({
      where: { id },
      data: {
        assignmentId: assignmentId,
        ...updateQuestionRequestDto,
        scoring,
        choices,
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
    const choices = updateQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(updateQuestionRequestDto.choices)
        ) as Prisma.InputJsonValue)
      : Prisma.JsonNull;

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
