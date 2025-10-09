/* eslint-disable unicorn/no-null */
import {
  AssignmentAttempt,
  QuestionResponse,
  QuestionType,
  ResponseType,
  Translation,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { AssignmentAttemptQuestions } from "src/api/assignment/attempt/dto/assignment-attempt/get.assignment.attempt.response.dto";
import {
  AttemptQuestionDto,
  Choice,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "../../../../prisma.service";

/**
 * Extended Choice type to include optional id property
 */
export interface ExtendedChoice extends Choice {
  id?: number;
}

/**
 * Enhanced AttemptQuestionDto with additional properties
 */
export interface EnhancedAttemptQuestionDto extends AttemptQuestionDto {
  variantId?: number;
  videoPresentationConfig?:
    | VideoPresentationConfig
    | Record<string, unknown>
    | null;
  liveRecordingConfig?: Record<string, unknown> | null;
  isDeleted: boolean;
  randomizedChoices?: string | null;
  randomizedChoicesFlag?: boolean | null;
  gradingContextQuestionIds: number[];
}

/**
 * Generic type for Prisma nested variants
 */
export type PrismaNestedVariant = {
  questionId: number;
  questionVariant?: {
    id: number;
    variantContent?: string;
    maxWords?: number | null;
    maxCharacters?: number | null;
    scoring?: JsonValue;
    choices?: JsonValue;
    answer?: string | null;
    variantOf: {
      id: number;
      question: string;
      type: QuestionType;
      assignmentId: number;
      maxWords?: number | null;
      maxCharacters?: number | null;
      scoring?: JsonValue;
      choices?: JsonValue;
      answer?: string | null;
      totalPoints: number;
      gradingContextQuestionIds?: number[];
      responseType?: ResponseType | null;
      isDeleted: boolean;
      randomizedChoices?: boolean | null;
      videoPresentationConfig?: JsonValue;
      liveRecordingConfig?: JsonValue;
    };
  } | null;
  randomizedChoices?: string | null;
};

/**
 * Interface for translated content
 */
export interface TranslatedContent {
  translatedText: string;
  translatedChoices?: ExtendedChoice[] | string;
}

/**
 * Enhanced AssignmentAttempt with related data
 */
export type AssignmentAttemptWithRelations = AssignmentAttempt & {
  questionResponses: QuestionResponse[];
  questionVariants: PrismaNestedVariant[];
};
/**
 * Minimal version of Assignment with only the properties needed for mapping
 */
export interface AssignmentForMapping {
  id: number;
  questionOrder?: number[] | null;
  displayOrder?: string;
  passingGrade?: number;
  showAssignmentScore?: boolean;
  showSubmissionFeedback?: boolean;
  showQuestionScore?: boolean;
}
/**
 * Utility class for mapping and transforming questions for assignment attempts
 */
export class AttemptQuestionsMapper {
  /**
   * Build questions with responses for an attempt
   */
  static async buildQuestionsWithResponses(
    assignmentAttempt: AssignmentAttemptWithRelations,
    questions: EnhancedAttemptQuestionDto[],
    assignment: AssignmentForMapping,
    prisma: PrismaService,
    language?: string,
  ): Promise<AssignmentAttemptQuestions[]> {
    const questionOrder: number[] = assignmentAttempt.questionOrder?.length
      ? assignmentAttempt.questionOrder
      : assignment.questionOrder?.length
        ? assignment.questionOrder
        : questions.map((q) => q.id);

    const questionById = new Map<number, EnhancedAttemptQuestionDto>(
      questions.map((q) => [q.id, q]),
    );

    const questionVariantsArray = assignmentAttempt.questionVariants ?? [];
    const questionsWithVariants = questionVariantsArray
      .map((qv) => {
        const variant = qv.questionVariant;
        const originalQ = questionById.get(qv.questionId);

        if (!originalQ) {
          return null;
        }

        const questionText = variant?.variantContent ?? originalQ.question;
        const scoring = variant?.scoring ?? originalQ.scoring;
        const maxWords = variant?.maxWords ?? originalQ.maxWords;
        const maxChars = variant?.maxCharacters ?? originalQ.maxCharacters;

        const finalChoices = qv.randomizedChoices
          ? this.parseChoices(qv.randomizedChoices)
          : this.parseChoices(variant?.choices ?? originalQ.choices);

        return {
          id: originalQ.id,
          variantId: variant ? variant.id : undefined,
          question: questionText,
          choices: finalChoices,
          maxWords,
          maxCharacters: maxChars,
          scoring: scoring as ScoringDto,
          totalPoints: originalQ.totalPoints,
          answer: variant?.answer ?? originalQ.answer,
          type: originalQ.type,
          assignmentId: originalQ.assignmentId,
          gradingContextQuestionIds: originalQ.gradingContextQuestionIds,
          responseType: originalQ.responseType,
          isDeleted: originalQ.isDeleted,
          randomizedChoices: originalQ.randomizedChoices,
          videoPresentationConfig: originalQ.videoPresentationConfig,
          liveRecordingConfig: originalQ.liveRecordingConfig,
        } as EnhancedAttemptQuestionDto;
      })
      .filter((q): q is EnhancedAttemptQuestionDto => q !== null);

    const questionVariantsMap = new Map<number, EnhancedAttemptQuestionDto>(
      questionsWithVariants.map((question) => [question.id, question]),
    );

    const mergedQuestions = questions.map((originalQ) => {
      const variantQ = questionVariantsMap.get(originalQ.id);
      if (variantQ) {
        return variantQ;
      }
      return { ...originalQ, variantId: undefined };
    });

    const questionsWithResponses = this.constructQuestionsWithResponses(
      mergedQuestions,
      assignmentAttempt.questionResponses,
    );

    const finalQuestions = questionOrder
      .map((qId) => questionsWithResponses.find((q) => q.id === qId))
      .filter((q): q is AssignmentAttemptQuestions => q !== undefined);

    if (language && language !== "en") {
      await this.applyTranslations(finalQuestions, prisma, language);
    }

    return finalQuestions;
  }
  /**
   * Build questions with translations for an assignment attempt
   *
   * @param assignmentAttempt - The assignment attempt with its relations
   * @param assignment - The assignment data with questions
   * @param translations - Map of translations keyed by entity type and ID
   * @param language - Target language code
   * @returns Array of enhanced attempt questions with proper translations
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  static async buildQuestionsWithTranslations(
    assignmentAttempt: AssignmentAttemptWithRelations,
    assignment: UpdateAssignmentQuestionsDto,
    translations: Map<string, Record<string, TranslatedContent>>,
    language: string,
  ): Promise<EnhancedAttemptQuestionDto[]> {
    const questionOrder =
      assignmentAttempt.questionOrder || assignment.questionOrder || [];

    const questionVariantsArray = assignmentAttempt.questionVariants ?? [];
    const processedQuestions = questionVariantsArray
      .map((qv) => {
        const variant = qv.questionVariant;
        const originalQ = assignment.questions.find(
          (q) => q.id === qv.questionId,
        );

        if (!originalQ) return null;

        const variantKey = `variant-${variant?.id}`;
        const questionKey = `question-${qv.questionId}`;

        const variantTranslations =
          variant && translations.has(variantKey)
            ? translations.get(variantKey) || {}
            : {};

        const questionTranslations = translations.has(questionKey)
          ? translations.get(questionKey) || {}
          : {};

        const variantTranslation = variantTranslations[language];
        const questionTranslation = questionTranslations[language];
        const primaryTranslation = variantTranslation || questionTranslation;

        const baseChoices = this.parseChoices(
          variant ? variant.choices || originalQ.choices : originalQ.choices,
        );

        let finalChoices = baseChoices || [];

        if (qv.randomizedChoices) {
          const randomizedChoicesArray = this.parseChoices(
            qv.randomizedChoices,
          );

          const permutation = randomizedChoicesArray
            .map((rc) => {
              const index =
                rc.id === undefined
                  ? baseChoices.findIndex((bc) => bc.choice === rc.choice)
                  : baseChoices.findIndex((bc) => bc.id === rc.id);
              return index;
            })
            .filter((index) => index !== -1);

          const orderedBaseChoices = permutation.map(
            (index) => baseChoices[index],
          );

          if (orderedBaseChoices.length === baseChoices.length) {
            finalChoices = orderedBaseChoices;
          }

          this.reorderTranslatedChoices(
            variantTranslations,
            permutation,
            baseChoices,
          );
          this.reorderTranslatedChoices(
            questionTranslations,
            permutation,
            baseChoices,
          );
        }

        const mergedTranslations = variant
          ? { ...questionTranslations, ...variantTranslations }
          : questionTranslations;

        if (qv.randomizedChoices && finalChoices.length > 0) {
          primaryTranslation.translatedChoices = finalChoices;
        }

        const sanitizedChoices = this.sanitizeChoicesForDisplay(
          Array.isArray(primaryTranslation.translatedChoices)
            ? (primaryTranslation.translatedChoices as unknown as ExtendedChoice[])
            : this.parseChoices(
                primaryTranslation.translatedChoices || finalChoices,
              ),
        );

        const sanitizedTranslations =
          this.sanitizeTranslationsChoices(mergedTranslations);
        return {
          id: originalQ.id,
          question: primaryTranslation.translatedText,
          choices: sanitizedChoices,
          translations: sanitizedTranslations,
          maxWords: variant?.maxWords ?? originalQ?.maxWords,
          maxCharacters: variant?.maxCharacters ?? originalQ?.maxCharacters,
          scoring:
            (variant?.scoring as unknown as ScoringDto) ?? originalQ.scoring,
          totalPoints: originalQ.totalPoints,
          answer: variant?.answer ?? originalQ.answer,
          type: originalQ.type,
          assignmentId: originalQ.assignmentId,
          gradingContextQuestionIds: originalQ.gradingContextQuestionIds,
          responseType: originalQ.responseType,
          isDeleted: originalQ.isDeleted,
          randomizedChoices: qv.randomizedChoices,
          videoPresentationConfig: originalQ.videoPresentationConfig,
          liveRecordingConfig: originalQ.liveRecordingConfig,
        } as unknown as EnhancedAttemptQuestionDto;
      })
      .filter((q): q is EnhancedAttemptQuestionDto => q !== null);

    const questionsWithoutVariants = assignment.questions
      .filter(
        (q) => !questionVariantsArray.some((qv) => qv.questionId === q.id),
      )
      .map((originalQ) => {
        const questionKey = `question-${originalQ.id}`;
        const questionTranslations = translations.has(questionKey)
          ? translations.get(questionKey) || {}
          : {};

        const translationForLanguage = questionTranslations[language];

        const sanitizedChoices = this.sanitizeChoicesForDisplay(
          translationForLanguage?.translatedChoices
            ? this.parseChoices(translationForLanguage.translatedChoices)
            : this.parseChoices(originalQ.choices),
        );

        const sanitizedTranslations =
          this.sanitizeTranslationsChoices(questionTranslations);

        return {
          id: originalQ.id,
          question:
            translationForLanguage?.translatedText || originalQ.question,
          choices: sanitizedChoices,
          translations: sanitizedTranslations,
          maxWords: originalQ.maxWords,
          maxCharacters: originalQ.maxCharacters,
          scoring: originalQ.scoring,
          totalPoints: originalQ.totalPoints,
          answer: originalQ.answer,
          type: originalQ.type,
          assignmentId: originalQ.assignmentId,
          gradingContextQuestionIds: originalQ.gradingContextQuestionIds,
          responseType: originalQ.responseType,
          isDeleted: originalQ.isDeleted,
          randomizedChoices: originalQ.randomizedChoices,
          videoPresentationConfig: originalQ.videoPresentationConfig,
          liveRecordingConfig: originalQ.liveRecordingConfig,
        } as unknown as EnhancedAttemptQuestionDto;
      });

    const allQuestions = [...processedQuestions, ...questionsWithoutVariants];

    const finalQuestions =
      questionOrder.length > 0
        ? questionOrder
            .map((qId) => allQuestions.find((q) => q.id === qId))
            .filter((q): q is EnhancedAttemptQuestionDto => q !== undefined)
        : allQuestions;

    return finalQuestions;
  }

  /**
   * Sanitize choices for display by keeping only id and choice properties
   *
   * @param choices - The original choices array
   * @returns A new array with only id and choice properties
   */
  private static sanitizeChoicesForDisplay(
    choices: Choice[] | undefined | null | string,
  ): { id: number | null; choice: string }[] {
    if (!choices || typeof choices === "string") return [];

    return choices
      .filter((c): c is Choice => !!c && typeof c.choice === "string")
      .map((c) => ({
        id: c.id === undefined ? null : c.id,
        choice: c.choice,
      }));
  }

  /**
   * Sanitize choices in all translations
   *
   * @param translations - The translations object with choices
   * @returns A new translations object with sanitized choices
   */
  private static sanitizeTranslationsChoices(
    translations: Record<string, TranslatedContent>,
  ): Record<string, TranslatedContent> {
    const sanitizedTranslations: Record<string, TranslatedContent> = {};

    for (const [lang, content] of Object.entries(translations)) {
      sanitizedTranslations[lang] = {
        translatedText: content.translatedText,
        translatedChoices: content.translatedChoices
          ? (this.sanitizeChoicesForDisplay(
              Array.isArray(content.translatedChoices)
                ? (content.translatedChoices as unknown as ExtendedChoice[])
                : this.parseChoices(content.translatedChoices),
            ) as ExtendedChoice[])
          : null,
      };
    }

    return sanitizedTranslations;
  }

  /**
   * Construct questions with their corresponding responses
   */
  private static constructQuestionsWithResponses(
    questions: EnhancedAttemptQuestionDto[],
    questionResponses: QuestionResponse[],
  ): AssignmentAttemptQuestions[] {
    return questions.map((question) => {
      const correspondingResponses = questionResponses
        .filter((response) => response.questionId === question.id)
        .map((response) => ({
          id: response.id,
          variantId: question.variantId || null,
          assignmentAttemptId: response.assignmentAttemptId,
          questionId: response.questionId,
          learnerResponse: response.learnerResponse,
          points: response.points,
          feedback: response.feedback,
          metadata: {},
          gradedAt: null,
        }));

      const choices = this.parseChoices(question.choices);

      return {
        id: question.id,
        variantId: question.variantId,
        totalPoints: question.totalPoints,
        maxWords: question.maxWords,
        maxCharacters: question.maxCharacters,
        type: question.type,
        question: question.question,
        choices,
        assignmentId: question.assignmentId,
        alreadyInBackend: true,
        questionResponses: correspondingResponses,
        responseType: question.responseType,
        scoring: this.shouldShowScoring(question.scoring)
          ? question.scoring
          : undefined,
      } as AssignmentAttemptQuestions;
    });
  }

  /**
   * Apply translations to questions
   */
  private static async applyTranslations(
    questions: AssignmentAttemptQuestions[],
    prisma: PrismaService,
    language: string,
  ): Promise<void> {
    for (const question of questions) {
      const translation: Translation | null = await (question.variantId
        ? prisma.translation.findFirst({
            where: {
              questionId: question.id,
              variantId: question.variantId,
              languageCode: language,
            },
          })
        : prisma.translation.findFirst({
            where: {
              questionId: question.id,
              variantId: null,
              languageCode: language,
            },
          }));

      if (translation) {
        question.question = translation.translatedText;

        if (
          translation.translatedChoices !== undefined &&
          translation.translatedChoices !== null
        ) {
          question.choices = this.parseChoices(translation.translatedChoices);
        }
      }
    }
  }

  /**
   * Parse choices from various formats
   */
  private static parseChoices(choices: unknown): ExtendedChoice[] {
    if (!choices) return [];

    if (typeof choices === "string") {
      try {
        choices = JSON.parse(choices);
      } catch {
        return [];
      }
    }

    if (Array.isArray(choices)) {
      return choices as ExtendedChoice[];
    }

    if (typeof choices === "object" && choices !== null) {
      return Object.values(choices) as ExtendedChoice[];
    }
    return [];
  }

  /**
   * Determine if scoring rubrics should be shown to learner
   */
  private static shouldShowScoring(scoring: ScoringDto | unknown): boolean {
    if (!scoring) return false;

    if (typeof scoring === "string") {
      try {
        const parsedScoring = JSON.parse(scoring) as {
          showRubricsToLearner?: boolean;
        };
        return parsedScoring.showRubricsToLearner === true;
      } catch {
        return false;
      }
    }

    return (
      (scoring as { showRubricsToLearner?: boolean }).showRubricsToLearner ===
      true
    );
  }

  private static reorderTranslatedChoices(
    translations: Record<string, TranslatedContent>,
    permutation: number[],
    originalChoices: ExtendedChoice[],
  ): void {
    for (const lang in translations) {
      const translationObject = translations[lang];
      if (
        translationObject &&
        translationObject.translatedChoices &&
        Array.isArray(translationObject.translatedChoices) &&
        translationObject.translatedChoices.length === originalChoices.length
      ) {
        const origTranslatedChoices =
          translationObject.translatedChoices as unknown as ExtendedChoice[];
        const reorderedTranslatedChoices = permutation.map(
          (index) => origTranslatedChoices[index],
        );

        translationObject.translatedChoices = reorderedTranslatedChoices;
      }
    }
  }
}
