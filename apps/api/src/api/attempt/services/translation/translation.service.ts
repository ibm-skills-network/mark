/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../prisma.service";
import {
  QuestionDto,
  Choice,
  ScoringDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { QuestionService } from "src/api/assignment/question/question.service";
import {
  AssignmentAttempt,
  QuestionVariant,
  Translation,
} from "@prisma/client";
import { QuestionResponse } from "src/api/assignment/attempt/dto/assignment-attempt/create.update.assignment.attempt.request.dto";
import { TranslatedContent } from "../../common/utils/attempt-questions-mapper.util";
export type VariantMapping = {
  questionId: number;
  questionVariant: QuestionVariant | null;
};
@Injectable()
export class TranslationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly questionService: QuestionService,
  ) {}

  /**
   * Pre-translate questions for an assignment attempt
   * @param responsesForQuestions Responses for questions
   * @param assignmentAttempt The assignment attempt
   * @param language Requested language code
   * @returns Map of question IDs to translated questions
   */
  async preTranslateQuestions(
    responsesForQuestions: QuestionResponse[],
    assignmentAttempt: AssignmentAttempt & {
      questionVariants: VariantMapping[];
    },
    language?: string,
  ): Promise<Map<number, QuestionDto>> {
    // If no language is specified or it's English, no need to translate
    if (!language || language === "en") {
      return new Map<number, QuestionDto>();
    }

    const preTranslatedQuestions = new Map<number, QuestionDto>();

    // Process each question response
    for (const response of responsesForQuestions) {
      const questionId: number = response.id;
      const variantMapping = assignmentAttempt.questionVariants.find(
        (qv) => qv.questionId === questionId,
      );

      let question: QuestionDto;

      // Get the question with or without variant
      question = await (variantMapping &&
      variantMapping.questionVariant !== null
        ? this.getQuestionFromVariant(variantMapping)
        : this.questionService.findOne(questionId));

      // Apply translation
      question = await this.applyTranslationToQuestion(
        question,
        language,
        variantMapping,
      );

      preTranslatedQuestions.set(questionId, question);
    }

    return preTranslatedQuestions;
  }

  /**
   * Get all translations for an assignment attempt
   * @param assignmentAttempt The assignment attempt
   * @param assignmentQuestions Questions in the assignment
   * @returns Map of translations
   */
  async getTranslationsForAttempt(
    assignmentAttempt: AssignmentAttempt & {
      questionVariants: VariantMapping[];
    },
    assignmentQuestions: QuestionDto[],
  ): Promise<Map<string, Record<string, TranslatedContent>>> {
    // Get IDs for questions and variants
    const questionIds = assignmentQuestions.map((q) => q.id);
    const variantIds = assignmentAttempt.questionVariants
      .map((qv) => qv.questionVariant?.id)
      .filter((id) => id !== undefined);

    // Build query conditions
    const conditions = [];
    if (questionIds.length > 0) {
      conditions.push({ questionId: { in: questionIds } });
    }
    if (variantIds.length > 0) {
      conditions.push({ variantId: { in: variantIds } });
    }

    // If no questions or variants, return empty map
    if (conditions.length === 0) {
      return new Map();
    }

    // Fetch all translations
    const translations = await this.prisma.translation.findMany({
      where: {
        OR: [
          { questionId: { in: questionIds } },
          ...(variantIds.length > 0 ? [{ variantId: { in: variantIds } }] : []),
        ],
      },
    });

    // Build translation map for lookup
    const translationMap = new Map<string, Record<string, any>>();

    for (const t of translations) {
      const key = t.variantId
        ? `variant-${t.variantId}`
        : `question-${t.questionId}`;

      if (!translationMap.has(key)) {
        translationMap.set(key, {});
      }

      const mapEntry = translationMap.get(key);
      if (mapEntry) {
        mapEntry[t.languageCode] = {
          translatedText: t.translatedText,
          translatedChoices: t.translatedChoices,
        };
      }
    }

    return translationMap;
  }

  /**
   * Apply translation to a question
   * @param question The question to translate
   * @param language Target language code
   * @param variantMapping Optional variant mapping
   * @returns Translated question
   */
  async applyTranslationToQuestion(
    question: QuestionDto,
    language: string,
    variantMapping?: VariantMapping,
  ): Promise<QuestionDto> {
    if (!language || language === "en") {
      return question;
    }

    let translation: Translation | null = null;

    // If there's a variant, try to fetch translation for the variant first
    if (
      variantMapping &&
      variantMapping.questionVariant !== null &&
      variantMapping.questionVariant
    ) {
      translation = await this.prisma.translation.findFirst({
        where: {
          questionId: variantMapping.questionId,
          variantId: variantMapping.questionVariant.id,
          languageCode: language,
        },
      });

      // If no variant translation, fall back to base question translation
      if (!translation) {
        translation = await this.prisma.translation.findFirst({
          where: {
            questionId: question.id,
            variantId: null,
            languageCode: language,
          },
        });
      }
    } else {
      // No variant, just get translation for the base question
      translation = await this.prisma.translation.findFirst({
        where: {
          questionId: question.id,
          variantId: null,
          languageCode: language,
        },
      });
    }

    // Apply translation if found
    if (translation) {
      question.question = translation.translatedText;

      if (translation.translatedChoices) {
        if (typeof translation.translatedChoices === "string") {
          try {
            question.choices = JSON.parse(
              translation.translatedChoices,
            ) as Choice[];
          } catch {
            question.choices = []; // Default to empty array on failure
          }
        } else if (Array.isArray(translation.translatedChoices)) {
          question.choices =
            translation.translatedChoices as unknown as Choice[];
        }
      }
    }

    return question;
  }

  /**
   * Build a QuestionDto from a variant mapping
   * @param variantMapping The variant mapping
   * @returns A question DTO
   */
  private async getQuestionFromVariant(
    variantMapping: VariantMapping,
  ): Promise<QuestionDto> {
    const variant = variantMapping.questionVariant;
    // Fetch the base question using questionId
    const baseQuestion = await this.questionService.findOne(variant.questionId);

    return {
      id: variant.id,
      question: variant.variantContent,
      type: baseQuestion.type,
      assignmentId: baseQuestion.assignmentId,
      maxWords: variant.maxWords ?? baseQuestion.maxWords,
      maxCharacters: variant.maxCharacters ?? baseQuestion.maxCharacters,
      scoring: (this.parseJsonField(variant.scoring) ??
        this.parseJsonField(baseQuestion.scoring)) as ScoringDto,
      choices: (this.parseJsonField(variant.choices) ??
        this.parseJsonField(baseQuestion.choices)) as Choice[],
      answer: baseQuestion.answer ?? variant.answer,
      alreadyInBackend: true,
      totalPoints: baseQuestion.totalPoints,
      gradingContextQuestionIds: baseQuestion.gradingContextQuestionIds ?? [],
    };
  }

  /**
   * Parse a JSON field from string or direct object
   * @param field Field to parse
   * @returns Parsed object or null
   */
  private parseJsonField(field: unknown): unknown {
    if (!field) return null;

    if (typeof field === "string") {
      try {
        return JSON.parse(field);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`Error parsing JSON field: ${errorMessage}`);
        return null;
      }
    }

    return field;
  }
}
