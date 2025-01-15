import {
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, QuestionType, ResponseType } from "@prisma/client";
import { PrismaService } from "../../../prisma.service";
import { LlmService } from "../../llm/llm.service";
import { QuestionDto } from "../dto/update.questions.request.dto";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import {
  Choice,
  CreateUpdateQuestionRequestDto,
  Scoring,
} from "./dto/create.update.question.request.dto";

@Injectable()
export class QuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

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

  async findOne(id: number): Promise<QuestionDto> {
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
    questions: {
      id: number;
      questionText: string;
      questionType: string;
      responseType?: ResponseType;
    }[],
    variantMode: boolean,
    assignmentId: number,
  ): Promise<Record<number, string>> {
    // apply guard rails
    const markingRubric = await this.llmService.createMarkingRubric(
      questions,
      variantMode,
      assignmentId,
    );
    const formattedMarkingRubric: Record<number, string> = {};
    for (const key in markingRubric) {
      formattedMarkingRubric[key] =
        typeof markingRubric[key] === "string"
          ? markingRubric[key]
          : JSON.stringify(markingRubric[key]);
    }
    return formattedMarkingRubric;
  }
  /**
   * Generate translations for the relevant parts of a question (text and choices) if not already present in the database.
   * @param questionId The ID of the question to translate.
   * @param languageCode The target language code for translation.
   * @param language The target language name (e.g., French, Spanish) for context.
   * @returns The translated question text and choices (if applicable).
   */
  async generateTranslationIfNotExists(
    assignmentId: number,
    question: QuestionDto,
    languageCode: string,
    language: string,
  ): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
    // Check if the translation already exists
    const questionId = question.id;
    const existingTranslation = await this.prisma.translation.findUnique({
      where: {
        questionId_languageCode: { questionId, languageCode },
      },
    });

    if (existingTranslation) {
      // check if the saved question is the same as the current question
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
        // delete the existing translation if the question has been updated
        await this.prisma.translation.delete({
          where: {
            questionId_languageCode: { questionId, languageCode },
          },
        });
      }
    }

    if (!question) {
      throw new NotFoundException(`Question with ID ${questionId} not found.`);
    }

    // Generate translations for the question text and choices using the LLM service
    const translatedQuestion =
      await this.llmService.generateQuestionTranslation(
        assignmentId,
        question.question,
        language,
      );

    // let translatedChoices: Choice[] | undefined;
    // if (question.choices) {
    //   translatedChoices = await this.llmService.generateChoicesTranslation(
    //     question.choices as unknown as Choice[],
    //     language
    //   );
    // }

    // Save the new translation to the database
    await this.prisma.translation.create({
      data: {
        questionId,
        languageCode,
        translatedText: translatedQuestion,
        untranslatedText: question.question,
        // translatedChoices: translatedChoices
        //   ? (translatedChoices as unknown as Prisma.JsonValue)
        //   : undefined,
      },
    });

    return {
      translatedQuestion,
      // , translatedChoices
    };
  }

  private async applyGuardRails(
    createUpdateQuestionRequestDto: CreateUpdateQuestionRequestDto,
  ): Promise<void> {
    const guardRailsValidation = await this.llmService.applyGuardRails(
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
