import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { Logger } from "winston";
import { PrismaService } from "../../../prisma.service";
import { LearnerLiveRecordingFeedback } from "../attempt/dto/assignment-attempt/types";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VideoPresentationConfig,
} from "../dto/update.questions.request.dto";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";

@Injectable()
export class QuestionService {
  private logger: Logger;
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmFacadeService: LlmFacadeService,
    @Inject(WINSTON_MODULE_PROVIDER) private parentLogger: Logger,
  ) {
    this.logger = parentLogger.child({
      context: "QuestionService",
    });
  }

  async create(
    assignmentId: number,
    createQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(createQuestionRequestDto);
    const scoring = createQuestionRequestDto.scoring
      ? (createQuestionRequestDto.scoring as object)
      : undefined;
    const choices = createQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(createQuestionRequestDto.choices),
        ) as Prisma.InputJsonValue)
      : Prisma.JsonNull;

    const dataToSave = {
      assignmentId: assignmentId,
      ...createQuestionRequestDto,
      scoring,
      choices,
    };

    const result = await this.prisma.question.create({
      data: dataToSave,
    });

    return {
      id: result.id,
      success: true,
    };
  }

  async findOne(id: number): Promise<QuestionDto> {
    if (!id || Number.isNaN(Number(id))) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    const result = await this.prisma.question.findUnique({
      where: { id },
    });

    if (!result) {
      throw new NotFoundException(`Question with Id ${id} not found.`);
    }

    return {
      ...result,
      scoring: result.scoring
        ? (result.scoring as unknown as ScoringDto)
        : undefined,
      choices: result.choices
        ? (result.choices as unknown as Choice[])
        : undefined,
      assignmentId: result.assignmentId,
      videoPresentationConfig: result.videoPresentationConfig
        ? (result.videoPresentationConfig as unknown as VideoPresentationConfig)
        : undefined,
      liveRecordingConfig: result.liveRecordingConfig
        ? (result.liveRecordingConfig as unknown as object)
        : undefined,
      alreadyInBackend: true,
      success: true,
    };
  }

  async update(
    assignmentId: number,
    id: number,
    updateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(updateQuestionRequestDto);
    const scoring = (updateQuestionRequestDto.scoring as object) || undefined;
    const choices = updateQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(updateQuestionRequestDto.choices),
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
    updateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<BaseQuestionResponseDto> {
    await this.applyGuardRails(updateQuestionRequestDto);
    const scoring =
      (updateQuestionRequestDto.scoring as object) || Prisma.JsonNull;
    // eslint-disable-next-line unicorn/no-null
    const answer = updateQuestionRequestDto.answer || null;
    const choices = updateQuestionRequestDto.choices
      ? (JSON.parse(
          JSON.stringify(updateQuestionRequestDto.choices),
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
  async createMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
    rubricIndex?: number,
  ): Promise<ScoringDto | Choice[]> {
    if (!question) {
      throw new NotFoundException(`Question DTO not provided or is invalid.`);
    }
    const textTypes = new Set(["TEXT", "URL", "UPLOAD", "LINK_FILE"]);
    const choiceTypes = new Set(["SINGLE_CORRECT", "MULTIPLE_CORRECT"]);
    if (textTypes.has(question.type)) {
      return await this.llmFacadeService.createMarkingRubric(
        question,
        assignmentId,
        rubricIndex ?? undefined,
      );
    } else if (choiceTypes.has(question.type)) {
      return await this.llmFacadeService.createChoices(question, assignmentId);
    } else {
      throw new HttpException(
        "Invalid question type for creating marking rubric",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
  async expandMarkingRubric(
    question: QuestionDto,
    assignmentId: number,
  ): Promise<QuestionDto> {
    if (!question) {
      throw new NotFoundException(`Question DTO not provided or is invalid.`);
    }
    const textTypes = new Set(["TEXT", "URL", "UPLOAD", "LINK_FILE"]);
    if (textTypes.has(question.type)) {
      const expandedRubric = await this.llmFacadeService.expandMarkingRubric(
        question,
        assignmentId,
      );
      return {
        ...question,
        scoring: {
          ...question.scoring,
          rubrics: expandedRubric.rubrics,
        },
      };
    } else {
      throw new HttpException(
        "Invalid question type for creating marking rubric",
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async getLiveRecordingFeedback(
    liveRecordingData: LearnerLiveRecordingFeedback,
    assignmentId: number,
  ): Promise<{ feedback: string }> {
    if (!liveRecordingData.question) {
      throw new NotFoundException(`Question is not found.`);
    }

    const feedback = await this.llmFacadeService.getLiveRecordingFeedback(
      liveRecordingData,
      assignmentId,
    );

    return { feedback };
  }
  /**
   * Generate translations for the relevant parts of a question (text and choices) if not already present in the database.
   * @param assignmentId The ID of the assignment (context for LLM).
   * @param question The question DTO whose text is to be translated.
   * @param languageCode The target language code (e.g., "fr", "es").
   * @param language The target language name (e.g., "French", "Spanish").
   * @returns The translated question text and choices (if applicable).
   */
  async generateTranslationIfNotExists(
    assignmentId: number,
    question: QuestionDto,
    languageCode: string,
    language: string,
  ): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
    if (!question) {
      throw new NotFoundException(`Question DTO not provided or is invalid.`);
    }

    const questionId = question.id;
    const existingTranslation = await this.prisma.translation.findFirst({
      where: {
        questionId,
        variantId: undefined,
        languageCode,
      },
    });

    if (existingTranslation) {
      if (
        existingTranslation.untranslatedText === question.question &&
        existingTranslation.translatedText
      ) {
        return {
          translatedQuestion: existingTranslation.translatedText,
          translatedChoices: existingTranslation.translatedChoices
            ? (existingTranslation.translatedChoices as unknown as Choice[])
            : undefined,
        };
      } else {
        await this.prisma.translation.deleteMany({
          where: {
            questionId,
            variantId: undefined,
            languageCode,
          },
        });
      }
    }

    const translatedQuestion =
      await this.llmFacadeService.generateQuestionTranslation(
        assignmentId,
        question.question,
        language,
      );

    await this.prisma.translation.create({
      data: {
        questionId,
        variantId: undefined,
        languageCode,
        translatedText: translatedQuestion,
        untranslatedText: question.question,
      },
    });

    return {
      translatedQuestion,
    };
  }

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<void> {
    const guardRailsValidation = await this.llmFacadeService.applyGuardRails(
      JSON.stringify(createUpdateQuestionRequestDto),
    );
    if (!guardRailsValidation) {
      throw new HttpException(
        "Question validation failed due to inappropriate or unacceptable content",
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
