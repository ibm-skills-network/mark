/* eslint-disable unicorn/no-null */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma, Question, QuestionVariant } from "@prisma/client";
import { PrismaService } from "src/database/prisma.service";
import {
  Choice,
  QuestionDto,
  ScoringDto,
  VariantDto,
  VideoPresentationConfig,
} from "../../dto/update.questions.request.dto";

/**
 * Repository for Question data access operations
 */
@Injectable()
export class QuestionRepository {
  private readonly logger = new Logger(QuestionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a question by ID
   *
   * @param id - Question ID
   * @returns Question or null if not found
   */
  async findById(id: number): Promise<Question | null> {
    return this.prisma.question.findUnique({
      where: { id },
    });
  }

  /**
   * Find all questions for an assignment
   *
   * @param assignmentId - Assignment ID
   * @returns Array of questions with their variants
   */
  async findByAssignmentId(assignmentId: number): Promise<QuestionDto[]> {
    try {
      const questions = await this.prisma.question.findMany({
        where: {
          assignmentId,
          isDeleted: false,
        },
        include: {
          variants: {
            where: { isDeleted: false },
          },
        },
      });

      return questions.map((question) => this.mapToQuestionDto(question));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error fetching questions for assignment ${assignmentId}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }
  /**
   * Create or update a question
   *
   * @param questionDto - Question data to create or update
   * @returns Created or updated question
   */
  async upsert(questionDto: QuestionDto): Promise<Question> {
    try {
      const { id, ...questionData } = questionDto;

      if (id === undefined) {
        throw new Error("Question ID is required for upsert operation");
      }

      const updateData: Prisma.QuestionUpdateInput = {
        totalPoints: questionData.totalPoints,
        type: questionData.type,
        question: questionData.question,
        responseType: questionData.responseType,
        maxWords: questionData.maxWords,
        maxCharacters: questionData.maxCharacters,
        randomizedChoices: questionData.randomizedChoices,
        answer: questionData.answer,
        choices: this.prepareJsonField(questionData.choices),
        scoring: this.prepareJsonField(questionData.scoring),
        videoPresentationConfig: this.prepareJsonField(
          questionData.videoPresentationConfig,
        ),
        liveRecordingConfig: questionData.liveRecordingConfig,
        gradingContextQuestionIds: questionData.gradingContextQuestionIds,
        isDeleted: questionData.isDeleted,
      };

      // Create data needs assignment connection, use only plain values
      const createData: Prisma.QuestionCreateInput = {
        totalPoints: questionData.totalPoints,
        type: questionData.type,
        question: questionData.question,
        responseType: questionData.responseType,
        maxWords: questionData.maxWords,
        maxCharacters: questionData.maxCharacters,
        randomizedChoices: questionData.randomizedChoices,
        answer: questionData.answer,
        choices: this.prepareJsonField(questionData.choices),
        scoring: this.prepareJsonField(questionData.scoring),
        videoPresentationConfig: this.prepareJsonField(
          questionData.videoPresentationConfig,
        ),
        liveRecordingConfig: questionData.liveRecordingConfig,
        gradingContextQuestionIds: questionData.gradingContextQuestionIds,
        isDeleted: questionData.isDeleted,
        assignment: questionData.assignmentId
          ? { connect: { id: questionData.assignmentId } }
          : undefined,
      };

      const returnValue = await this.prisma.question.upsert({
        where: { id },
        update: updateData,
        create: createData,
      });
      // Handle upsert operation with properly typed data
      return returnValue;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error upserting question: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Mark questions as deleted
   *
   * @param ids - Array of question IDs to mark as deleted
   */
  async markAsDeleted(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    try {
      await this.prisma.question.updateMany({
        where: { id: { in: ids } },
        data: { isDeleted: true },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error marking questions as deleted: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Create a bulk of questions in a transaction
   *
   * @param questions - Array of question data to create
   * @returns Array of created questions
   */
  async createMany(questions: QuestionDto[]): Promise<Question[]> {
    try {
      return await this.prisma.$transaction(
        questions.map((questionData) => {
          const {
            totalPoints = 0,
            type,
            question,
            assignmentId,
            responseType,
            maxWords,
            maxCharacters,
            randomizedChoices,
            liveRecordingConfig,
            answer,
            gradingContextQuestionIds = [],
            isDeleted = false,
            translations,
          } = questionData;

          const choices = this.prepareJsonField(questionData.choices);
          const scoring = this.prepareJsonField(questionData.scoring);
          const videoPresentationConfig = this.prepareJsonField(
            questionData.videoPresentationConfig,
          );

          const translationsData =
            translations && Array.isArray(translations)
              ? {
                  create: translations.map(
                    (t: {
                      languageCode: string;
                      translatedText?: string;
                      untranslatedText?: string;
                      translatedChoices?: unknown;
                      untranslatedChoices?: unknown;
                    }) => ({
                      languageCode: t.languageCode,
                      translatedText: t.translatedText,
                      untranslatedText: t.untranslatedText,
                      translatedChoices: this.prepareJsonField(
                        t.translatedChoices,
                      ),
                      untranslatedChoices: this.prepareJsonField(
                        t.untranslatedChoices,
                      ),
                    }),
                  ),
                }
              : undefined;

          const data: Prisma.QuestionCreateInput = {
            totalPoints,
            type,
            question,
            responseType,
            maxWords,
            maxCharacters,
            randomizedChoices,
            liveRecordingConfig,
            answer,
            gradingContextQuestionIds,
            isDeleted,
            choices,
            scoring,
            videoPresentationConfig,
            assignment: { connect: { id: assignmentId } },
            translations: translationsData,
          };

          return this.prisma.question.create({ data });
        }),
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error in bulk question creation: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Convert database question to DTO
   *
   * @param question - Raw question data from database
   * @returns Question DTO
   */
  private mapToQuestionDto(
    question: Question & { variants?: QuestionVariant[] },
  ): QuestionDto {
    try {
      const processedVariants: VariantDto[] = question.variants
        ? question.variants.map((variant) => {
            return {
              ...variant,
              choices: this.parseJsonField<Choice[]>(variant.choices),
              scoring: this.parseJsonField<ScoringDto>(variant.scoring),
            } as VariantDto;
          })
        : [];

      return {
        ...question,
        choices: this.parseJsonField<Choice[]>(question.choices),
        scoring: this.parseJsonField<ScoringDto>(question.scoring),
        videoPresentationConfig: this.parseJsonField<VideoPresentationConfig>(
          question.videoPresentationConfig,
        ),
        variants: processedVariants,
        alreadyInBackend: true,
      } as QuestionDto;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error mapping question ${question.id} to DTO: ${errorMessage}`,
        errorStack,
      );

      return {
        ...question,
        variants: [],
        alreadyInBackend: true,
      } as unknown as QuestionDto;
    }
  }

  /**
   * Parse a JSON field with type safety
   *
   * @param field - The field to parse, potentially a JSON string
   * @returns Parsed data with the appropriate type
   */
  private parseJsonField<T>(field: unknown): T | undefined {
    if (field === undefined || field === null) {
      return undefined;
    }

    if (typeof field === "string") {
      try {
        return JSON.parse(field) as T;
      } catch {
        return undefined;
      }
    }

    return field as T;
  }

  /**
   * Prepare question data for database operations
   *
   * @param questionData - Question data without variants
   * @returns Formatted question data for database
   */
  private prepareQuestionData(
    questionData: Omit<QuestionDto, "id" | "variants">,
  ): Prisma.QuestionUpdateInput {
    try {
      return {
        ...questionData,
        choices: this.prepareJsonField(questionData.choices),
        scoring: this.prepareJsonField(questionData.scoring),
        videoPresentationConfig: this.prepareJsonField(
          questionData.videoPresentationConfig,
        ),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Error preparing question data: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Prepare a field for storage as Prisma JSON
   *
   * @param field - Field to prepare
   * @returns Prepared field as Prisma.JsonValue
   */
  private prepareJsonField(field: unknown): Prisma.JsonValue | undefined {
    if (field === undefined) {
      return undefined;
    }

    if (field === null) {
      return null;
    }

    if (typeof field === "string") {
      try {
        JSON.parse(field);
        return field as Prisma.JsonValue;
      } catch {
        return JSON.stringify(field) as Prisma.JsonValue;
      }
    }

    return JSON.stringify(field) as Prisma.JsonValue;
  }
}
