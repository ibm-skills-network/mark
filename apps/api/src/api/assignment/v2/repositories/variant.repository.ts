/* eslint-disable unicorn/no-null */
import { Injectable, Logger } from "@nestjs/common";
import { Prisma, QuestionVariant } from "@prisma/client";
import { PrismaService } from "src/database/prisma.service";
import {
  Choice,
  ScoringDto,
  VariantDto,
  VariantType,
} from "../../dto/update.questions.request.dto";

/**
 * Repository for Question Variant data access operations
 */
@Injectable()
export class VariantRepository {
  private readonly logger = new Logger(VariantRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a variant by ID
   *
   * @param id - Variant ID
   * @returns Question variant or null if not found
   */
  async findById(id: number): Promise<QuestionVariant | null> {
    return this.prisma.questionVariant.findUnique({
      where: { id },
    });
  }

  /**
   * Find all variants for a question
   *
   * @param questionId - Question ID
   * @returns Array of question variants
   */
  async findByQuestionId(questionId: number): Promise<QuestionVariant[]> {
    try {
      return this.prisma.questionVariant.findMany({
        where: {
          questionId,
          isDeleted: false,
        },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error fetching variants for question ${questionId}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Create a new variant
   *
   * @param data - Variant data
   * @returns Created variant
   */
  async create(
    data: VariantDto & { questionId: number },
  ): Promise<QuestionVariant> {
    try {
      const createData = this.prepareVariantCreateData(data);

      return this.prisma.questionVariant.create({
        data: createData,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(`Error creating variant: ${errorMessage}`, errorStack);
      throw error;
    }
  }

  /**
   * Update an existing variant
   *
   * @param id - Variant ID
   * @param data - New variant data
   * @returns Updated variant
   */
  async update(
    id: number,
    data: VariantDto & { questionId: number },
  ): Promise<QuestionVariant> {
    try {
      const updateData = this.prepareVariantUpdateData(data);

      return this.prisma.questionVariant.update({
        where: { id },
        data: updateData,
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error updating variant ${id}: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Mark variants as deleted
   *
   * @param ids - Array of variant IDs
   */
  async markAsDeleted(ids: number[]): Promise<void> {
    if (ids.length === 0) return;

    try {
      await this.prisma.questionVariant.updateMany({
        where: { id: { in: ids } },
        data: { isDeleted: true },
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error marking variants as deleted: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Create multiple variants in a transaction
   *
   * @param variants - Array of variant data
   * @returns Array of created variants
   */
  async createMany(
    variants: (VariantDto & { questionId: number })[],
  ): Promise<QuestionVariant[]> {
    if (variants.length === 0) return [];

    try {
      return await this.prisma.$transaction(
        variants.map((variantData) => {
          const createData = this.prepareVariantCreateData(variantData);
          return this.prisma.questionVariant.create({ data: createData });
        }),
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error in bulk variant creation: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Prepare variant data for create operations
   *
   * @param data - Raw variant data
   * @returns Properly formatted create input for Prisma
   */
  private prepareVariantCreateData(
    data: VariantDto & { questionId: number },
  ): Prisma.QuestionVariantCreateInput {
    if (!data) {
      throw new Error("Invalid variant data");
    }
    if (!data.variantContent) {
      throw new Error("Variant content is required");
    }
    try {
      return {
        variantContent: data.variantContent,
        maxWords: data.maxWords,
        maxCharacters: data.maxCharacters,
        randomizedChoices: data.randomizedChoices ?? false,
        variantType: data.variantType ?? VariantType.REWORDED,
        createdAt: new Date(),
        choices: this.prepareJsonField(data.choices),
        scoring: this.prepareJsonField(data.scoring),
        variantOf: {
          connect: { id: data.questionId },
        },
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error preparing variant create data: ${errorMessage}`,
        errorStack,
      );
      throw error;
    }
  }

  /**
   * Prepare variant data for update operations
   *
   * @param data - Raw variant data
   * @returns Properly formatted update input for Prisma
   */
  private prepareVariantUpdateData(
    data: VariantDto,
  ): Prisma.QuestionVariantUpdateInput {
    if (!data) {
      throw new Error("Invalid variant data");
    }
    if (!data.variantContent) {
      throw new Error("Variant content is required");
    }

    try {
      return {
        variantContent: data.variantContent,
        maxWords: data.maxWords,
        maxCharacters: data.maxCharacters,
        randomizedChoices: data.randomizedChoices ?? undefined,
        variantType: data.variantType,
        choices: this.prepareJsonField(data.choices),
        scoring: this.prepareJsonField(data.scoring),
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorStack =
        error instanceof Error ? error.stack : "No stack trace";
      this.logger.error(
        `Error preparing variant update data: ${errorMessage}`,
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
   * Map a database variant to a DTO
   *
   * @param variant - Database variant
   * @returns Variant DTO with parsed fields
   */
  mapToVariantDto(
    variant: QuestionVariant,
  ): VariantDto & { questionId: number } {
    return {
      id: variant.id,
      questionId: variant.questionId,
      variantContent: variant.variantContent,
      choices: this.parseJsonField<Choice[]>(variant.choices),
      scoring: this.parseJsonField<ScoringDto>(variant.scoring),
      maxWords: variant.maxWords,
      maxCharacters: variant.maxCharacters,
      randomizedChoices: variant.randomizedChoices,
      variantType: VariantType.REWORDED,
    };
  }
}
