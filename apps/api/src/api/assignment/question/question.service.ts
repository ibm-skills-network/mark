/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { normalizeQuestionOrder } from "src/api/assignment/utils/question-order.util";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { Logger } from "winston";
import { PrismaService } from "../../../database/prisma.service";
import { LearnerLiveRecordingFeedback } from "../attempt/dto/assignment-attempt/types";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VideoPresentationConfig,
} from "../dto/update.questions.request.dto";
import type { JobScopedCache } from "../../attempt/services/grading/job-scoped-cache";
import { BaseQuestionResponseDto } from "./dto/base.question.response.dto";
import { CreateUpdateQuestionRequestDto } from "./dto/create.update.question.request.dto";

/**
 * Same body the exceptions filter sends for a temporary outage, so clients
 * handle every retryable 503 alike.
 */
export const TRANSLATION_UNAVAILABLE_BODY = {
  statusCode: 503,
  message: "Service temporarily unavailable",
} as const;

type PrismaTransactionalClient = Omit<
  PrismaService,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use"
>;

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

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.assignment.findUnique({
        where: { id: assignmentId },
        select: {
          questionOrder: true,
          questions: {
            where: { isDeleted: false },
            select: { id: true },
          },
        },
      });

      if (!assignment) {
        throw new NotFoundException(
          `Assignment with Id ${assignmentId} not found.`,
        );
      }

      const result = await tx.question.create({
        data: dataToSave,
      });

      await tx.assignment.update({
        where: { id: assignmentId },
        data: {
          questionOrder: normalizeQuestionOrder(
            [...assignment.questions.map((question) => question.id), result.id],
            assignment.questionOrder,
          ),
        },
      });

      return {
        id: result.id,
        success: true,
      };
    });
  }

  async findOne(
    id: number,
    tx?: PrismaTransactionalClient,
    cache?: JobScopedCache,
  ): Promise<QuestionDto> {
    if (!id || Number.isNaN(Number(id))) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    // Cache hit: build the DTO from the cached full Prisma Question row.
    const cached = cache?.questions.get(id);
    if (cached) {
      return {
        ...cached,
        scoring: cached.scoring
          ? (cached.scoring as unknown as ScoringDto)
          : undefined,
        choices: cached.choices
          ? (cached.choices as unknown as Choice[])
          : undefined,
        assignmentId: cached.assignmentId,
        videoPresentationConfig: cached.videoPresentationConfig
          ? (cached.videoPresentationConfig as unknown as VideoPresentationConfig)
          : undefined,
        liveRecordingConfig: cached.liveRecordingConfig
          ? (cached.liveRecordingConfig as unknown as object)
          : undefined,
        alreadyInBackend: true,
        success: true,
      };
    }

    // Cache miss (or no cache provided): fall through to the live read.
    const prisma = tx ?? this.prisma;
    const result = await prisma.question.findUnique({
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

  /**
   * Find a question for translation purposes - returns basic question data without sensitive information
   */
  async findOneForTranslation(id: number): Promise<QuestionDto> {
    if (!id || Number.isNaN(Number(id))) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }

    const result = await this.prisma.question.findUnique({
      where: { id },
      select: {
        id: true,
        question: true,
        type: true,
        assignmentId: true,
        totalPoints: true,
        maxWords: true,
        maxCharacters: true,
        choices: true,
        scoring: true,
        gradingContextQuestionIds: true,
        responseType: true,
        isDeleted: true,
        randomizedChoices: true,
        videoPresentationConfig: true,
        liveRecordingConfig: true,
      },
    });

    if (!result) {
      throw new NotFoundException(`Question with Id ${id} not found.`);
    }

    return {
      ...result,
      answer: undefined,
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
    return this.prisma.$transaction(async (tx) => {
      const existingQuestion = await tx.question.findUnique({
        where: { id },
        select: {
          id: true,
          assignmentId: true,
        },
      });

      if (!existingQuestion) {
        throw new NotFoundException(`Question with Id ${id} not found.`);
      }

      const assignment = await tx.assignment.findUnique({
        where: { id: existingQuestion.assignmentId },
        select: {
          questionOrder: true,
          questions: {
            where: {
              isDeleted: false,
              id: { not: id },
            },
            select: { id: true },
          },
        },
      });

      const result = await tx.question.delete({
        where: { id },
      });

      if (assignment) {
        await tx.assignment.update({
          where: { id: existingQuestion.assignmentId },
          data: {
            questionOrder: normalizeQuestionOrder(
              assignment.questions.map((question) => question.id),
              assignment.questionOrder.filter(
                (questionId) => questionId !== id,
              ),
            ),
          },
        });
      }

      return {
        id: result.id,
        success: true,
      };
    });
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
   * The stored translation of a question's authored text and choices, made
   * with the LLM on first request. A stored row whose source text no longer
   * matches the question is replaced. Only question-level rows are read or
   * written (`variantId: null`); variant translations are never touched.
   *
   * @param assignmentId The assignment the question belongs to (LLM usage context).
   * @param question The question to translate.
   * @param language A supported catalogue language (code and display name).
   * @throws ServiceUnavailableException when the LLM call fails or AI is switched off.
   */
  async generateTranslationIfNotExists(
    assignmentId: number,
    question: QuestionDto,
    language: { code: string; name: string },
  ): Promise<{ translatedQuestion: string; translatedChoices?: Choice[] }> {
    if (!question) {
      throw new NotFoundException(`Question DTO not provided or is invalid.`);
    }

    const questionId = question.id;
    const where = { questionId, variantId: null, languageCode: language.code };
    const existingTranslation = await this.prisma.translation.findFirst({
      where,
    });

    if (existingTranslation) {
      if (
        existingTranslation.untranslatedText === question.question &&
        existingTranslation.translatedText
      ) {
        this.logger.debug("Question translation served from store", {
          assignment_id: assignmentId,
          question_id: questionId,
          language_code: language.code,
        });
        return this.storedTranslation(existingTranslation);
      }
      await this.prisma.translation.deleteMany({ where });
    }

    let translatedQuestion: string;
    let translatedChoices: Choice[] | undefined;
    try {
      this.logger.info("Generating question translation", {
        assignment_id: assignmentId,
        question_id: questionId,
        language_code: language.code,
      });
      translatedQuestion =
        await this.llmFacadeService.generateQuestionTranslation(
          assignmentId,
          question.question,
          language.name,
        );
      if (question.choices && question.choices.length > 0) {
        translatedChoices =
          (await this.llmFacadeService.generateChoicesTranslation(
            question.choices,
            assignmentId,
            language.name,
          )) ?? undefined;
      }
    } catch (error: unknown) {
      // LLM outage, timeout or the AI kill switch: all are temporary from
      // the learner's side, so answer with a retryable 503.
      this.logger.error("Question translation failed", {
        assignment_id: assignmentId,
        question_id: questionId,
        language_code: language.code,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw new ServiceUnavailableException(TRANSLATION_UNAVAILABLE_BODY);
    }

    try {
      await this.prisma.translation.create({
        data: {
          questionId,
          variantId: null,
          languageCode: language.code,
          translatedText: translatedQuestion,
          untranslatedText: question.question,
          translatedChoices: translatedChoices
            ? (JSON.parse(
                JSON.stringify(translatedChoices),
              ) as Prisma.InputJsonValue)
            : undefined,
          untranslatedChoices: question.choices
            ? (JSON.parse(
                JSON.stringify(question.choices),
              ) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (error: unknown) {
      // A concurrent first request stored the same translation first; serve
      // the row that won rather than failing this one.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const winner = await this.prisma.translation.findFirst({ where });
        if (winner?.translatedText) {
          this.logger.info("Question translation race resolved to stored row", {
            assignment_id: assignmentId,
            question_id: questionId,
            language_code: language.code,
          });
          return this.storedTranslation(winner);
        }
      }
      this.logger.error("Storing question translation failed", {
        assignment_id: assignmentId,
        question_id: questionId,
        language_code: language.code,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }

    return {
      translatedQuestion,
      translatedChoices,
    };
  }

  private storedTranslation(row: {
    translatedText: string;
    translatedChoices: Prisma.JsonValue;
  }): { translatedQuestion: string; translatedChoices?: Choice[] } {
    let choices: unknown = row.translatedChoices;
    if (typeof choices === "string") {
      try {
        choices = JSON.parse(choices) as unknown;
      } catch (error: unknown) {
        // Unparsable stored choices: serve the text without them.
        this.logger.debug("Unparsable stored translated choices", {
          error: error instanceof Error ? error.message : String(error),
        });
        choices = undefined;
      }
    }
    return {
      translatedQuestion: row.translatedText,
      translatedChoices: Array.isArray(choices)
        ? (choices as Choice[])
        : undefined,
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
