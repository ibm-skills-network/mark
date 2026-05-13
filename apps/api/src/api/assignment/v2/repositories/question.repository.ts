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
   * Create a question and connect it to the given assignment. The database
   * autoincrements the primary key — any caller-supplied id is ignored.
   *
   * Use this for any flow where the caller cannot vouch that the supplied id
   * already belongs to the target assignment (e.g. publish payloads where the
   * id may have been generated client-side).
   */
  async createForAssignment(
    input: Omit<QuestionDto, "id">,
    assignmentId: number,
  ): Promise<Question> {
    this.logger.log(
      `createForAssignment entry { assignmentId: ${assignmentId} }`,
    );
    try {
      const createData: Prisma.QuestionCreateInput = {
        totalPoints: input.totalPoints,
        type: input.type,
        question: input.question,
        authorComment: input.authorComment ?? null,
        responseType: input.responseType,
        maxWords: input.maxWords,
        maxCharacters: input.maxCharacters,
        randomizedChoices: input.randomizedChoices,
        answer: input.answer,
        choices: this.prepareJsonField(input.choices),
        scoring: this.prepareJsonField(input.scoring),
        videoPresentationConfig: this.prepareJsonField(
          input.videoPresentationConfig,
        ),
        liveRecordingConfig: input.liveRecordingConfig,
        gradingContextQuestionIds: input.gradingContextQuestionIds,
        isDeleted: input.isDeleted ?? false,
        assignment: { connect: { id: assignmentId } },
      };

      const created = await this.prisma.question.create({ data: createData });
      this.logger.log(
        `createForAssignment outcome { assignmentId: ${assignmentId}, persistedId: ${created.id} }`,
      );
      return created;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `createForAssignment failed for assignment ${assignmentId}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Update a question only if it is owned by the given assignment.
   * Returns null when the row does not exist, is soft-deleted, or belongs to
   * a different assignment — the caller is expected to fall through to a
   * create in that case.
   *
   * The `assignmentId` predicate in the WHERE clause is the ownership check;
   * Prisma will only update when both id AND assignmentId match.
   */
  async updateOwnedById(
    id: number,
    assignmentId: number,
    update: Prisma.QuestionUpdateInput,
  ): Promise<Question | null> {
    this.logger.log(
      `updateOwnedById entry { assignmentId: ${assignmentId}, id: ${id} }`,
    );
    try {
      const result = await this.prisma.question.updateMany({
        where: { id, assignmentId, isDeleted: false },
        data: update,
      });

      if (result.count === 0) {
        this.logger.warn(
          `updateOwnedById ownership-miss { assignmentId: ${assignmentId}, id: ${id} }`,
        );
        return null;
      }

      const refreshed = await this.prisma.question.findUnique({
        where: { id },
      });
      this.logger.log(
        `updateOwnedById outcome { assignmentId: ${assignmentId}, persistedId: ${id} }`,
      );
      return refreshed;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `updateOwnedById failed for assignment ${assignmentId}, id ${id}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Create or update a question.
   *
   * WARNING: This method is global-by-id. The `where: { id }` clause matches
   * any Question row across all assignments. Do NOT use this in flows where
   * the caller cannot vouch that the supplied id is already owned by the
   * intended assignment — a colliding id will silently mutate a foreign row.
   * Prefer `createForAssignment` + `updateOwnedById` when handling caller-
   * supplied question payloads (e.g. publish).
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
        authorComment: questionData.authorComment ?? null,
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

      const createData: Prisma.QuestionCreateInput = {
        totalPoints: questionData.totalPoints,
        type: questionData.type,
        question: questionData.question,
        authorComment: questionData.authorComment ?? null,
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
            authorComment,
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
            authorComment: authorComment ?? null,
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
      const mediaHtml = this.extractMediaHtml(question.question);
      const processedVariants: VariantDto[] = question.variants
        ? question.variants.map((variant) => {
            return {
              ...variant,
              variantContent: this.appendMediaToContent(
                variant.variantContent,
                mediaHtml,
              ),
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

  private appendMediaToContent(content: string, mediaHtml: string): string {
    if (!mediaHtml) {
      return content;
    }

    if (/<img\b|<table\b/i.test(content)) {
      return content;
    }

    const separator = content ? "\n\n" : "";
    return `${content}${separator}${mediaHtml}`;
  }

  private extractMediaHtml(text: string): string {
    if (!text) {
      return "";
    }

    const mediaRegex = /<img\b[^>]*>|<table\b[^>]*>[\S\s]*?<\/table>/gi;
    const matches = text.match(mediaRegex);
    return matches ? matches.join("").trim() : "";
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
