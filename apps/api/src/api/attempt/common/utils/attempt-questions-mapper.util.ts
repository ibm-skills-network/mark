/* eslint-disable unicorn/no-null */
import { Logger } from "@nestjs/common";
import {
  AssignmentAttempt,
  QuestionResponse,
  QuestionType,
  ResponseType,
} from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import {
  AttemptQuestionDto,
  Choice,
  ScoringDto,
  UpdateAssignmentQuestionsDto,
  VideoPresentationConfig,
} from "src/api/assignment/dto/update.questions.request.dto";
import { PrismaService } from "../../../../database/prisma.service";
import { CompletedAttemptQuestionDto } from "../../dto/completed-attempt.response.dto";
import { sanitizeLearnerChoices } from "./learner-attempt-shape.util";

import {
  findQuestionTranslation,
  pickTranslation,
} from "./translation-language.util";

const logger = new Logger("AttemptQuestionsMapper");

/** A stored JSON value, parsed when held as JSON text; absent or unparsable is null. */
function parseStoredJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Unparsable text is treated as absent.
    return null;
  }
}

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
  translatedChoices?: ExtendedChoice[] | string | null;
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
/** What the completed-attempt shaping needs besides the questions. */
export interface CompletedQuestionOptions {
  /** Whether choices carry `isCorrect`/`feedback`. */
  revealAnswers: boolean;
  showQuestionScore: boolean;
  showSubmissionFeedback: boolean;
  /** The newest served response per question id. */
  responseByQuestionId: Map<number, QuestionResponse>;
}

/** A served question with the text and choices the learner saw. */
interface ServedQuestion {
  source: EnhancedAttemptQuestionDto;
  variantId: number | undefined;
  question: string;
  choices: ExtendedChoice[];
  scoring: unknown;
}

/**
 * Utility class for mapping and transforming questions for assignment attempts
 */
export class AttemptQuestionsMapper {
  /**
   * Build the questions of a submitted attempt for the results page, in the
   * order the attempt was served. Each question is shaped key by key: choices
   * carry `isCorrect`/`feedback` only when `revealAnswers` is set, rubrics only
   * when the author shows them, and the learner's newest response is attached
   * with its points and feedback nulled per the assignment's settings.
   */
  static async buildCompletedQuestions(
    assignmentAttempt: AssignmentAttemptWithRelations,
    questions: EnhancedAttemptQuestionDto[],
    assignment: AssignmentForMapping,
    prisma: PrismaService,
    options: CompletedQuestionOptions,
  ): Promise<CompletedAttemptQuestionDto[]> {
    const questionOrder: number[] = assignmentAttempt.questionOrder?.length
      ? assignmentAttempt.questionOrder
      : assignment.questionOrder?.length
        ? assignment.questionOrder
        : questions.map((q) => q.id);

    const questionById = new Map<number, EnhancedAttemptQuestionDto>(
      questions.map((q) => [q.id, q]),
    );
    const variantByQuestionId = new Map<number, PrismaNestedVariant>(
      (assignmentAttempt.questionVariants ?? []).map((qv) => [
        qv.questionId,
        qv,
      ]),
    );

    const served: ServedQuestion[] = [];
    for (const questionId of questionOrder) {
      const original = questionById.get(questionId);
      if (!original) continue;
      const pick = variantByQuestionId.get(questionId);
      const variant = pick?.questionVariant ?? undefined;
      // The frozen order wins; an attempt without one (stored as a non-array
      // such as `false`) shows the variant's or the question's own choices.
      const frozenChoices = this.parseChoices(pick?.randomizedChoices);
      served.push({
        source: original,
        variantId: variant?.id,
        question: variant?.variantContent ?? original.question,
        choices:
          frozenChoices.length > 0
            ? frozenChoices
            : this.parseChoices(variant?.choices ?? original.choices),
        scoring: variant?.scoring ?? original.scoring,
      });
    }

    const language = assignmentAttempt.preferredLanguage;
    if (language && !this.isAuthoredLanguage(language)) {
      await this.applyTranslations(served, prisma, language);
    }

    return served.map((question) =>
      this.toCompletedQuestion(
        question,
        options.responseByQuestionId.get(question.source.id),
        options,
      ),
    );
  }

  private static toCompletedQuestion(
    served: ServedQuestion,
    response: QuestionResponse | undefined,
    options: CompletedQuestionOptions,
  ): CompletedAttemptQuestionDto {
    const choices = sanitizeLearnerChoices(
      served.choices,
      options.revealAnswers,
    );
    const maxPoints = served.source.totalPoints;
    return {
      id: served.source.id,
      question: typeof served.question === "string" ? served.question : null,
      type: served.source.type,
      responseType: served.source.responseType ?? null,
      totalPoints: maxPoints,
      choices: choices.length > 0 ? choices : null,
      scoring: this.visibleScoring(served.scoring),
      response: response
        ? {
            learnerResponse: this.parseLearnerResponse(response),
            points: options.showQuestionScore
              ? this.clampPoints(response.points, maxPoints)
              : null,
            feedback: options.showSubmissionFeedback
              ? this.feedbackList(response.feedback)
              : null,
          }
        : null,
    };
  }

  /** Never more than the question's own maximum, as the totals are. */
  private static clampPoints(
    points: number | null | undefined,
    maxPoints: number | null | undefined,
  ): number | null {
    if (typeof points !== "number") return null;
    return typeof maxPoints === "number" ? Math.min(points, maxPoints) : points;
  }

  /** `learnerResponse` is stored as JSON text of the value graded. */
  private static parseLearnerResponse(response: QuestionResponse): unknown {
    try {
      return JSON.parse(response.learnerResponse) as unknown;
    } catch (error: unknown) {
      // Older rows hold plain text; serve it as stored.
      logger.debug(
        `Unparsable learnerResponse on response=${response.id} question=${response.questionId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return response.learnerResponse;
    }
  }

  /** Stored feedback is a list of feedback entries, sometimes as JSON text. */
  private static feedbackList(feedback: JsonValue): unknown[] | null {
    const parsed = parseStoredJson(feedback);
    if (Array.isArray(parsed)) return parsed as unknown[];
    if (parsed && typeof parsed === "object") return [parsed];
    return null;
  }

  /** Scoring is the grading key; only shown when the author opted in. */
  private static visibleScoring(
    scoring: unknown,
  ): Record<string, unknown> | null {
    const parsed = parseStoredJson(scoring);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    return record.showRubricsToLearner === true ? { ...record } : null;
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

        const variantTranslations = this.withoutAuthoredLanguage(
          variant && translations.has(variantKey)
            ? translations.get(variantKey) || {}
            : {},
        );

        const questionTranslations = this.withoutAuthoredLanguage(
          translations.has(questionKey)
            ? translations.get(questionKey) || {}
            : {},
        );

        const variantTranslation = pickTranslation(
          variantTranslations,
          language,
        );
        const questionTranslation = pickTranslation(
          questionTranslations,
          language,
        );

        const baseChoices = this.parseChoices(
          variant ? variant.choices || originalQ.choices : originalQ.choices,
        );

        // Translations are generated lazily per language, so a learner can ask
        // for one that has no row yet. Serve the authored content in that case
        // instead of dereferencing an absent translation.
        const storedTranslation = variantTranslation || questionTranslation;
        const primaryTranslation =
          storedTranslation ||
          this.buildUntranslatedContent(
            variant,
            originalQ,
            baseChoices,
            language,
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

          // A partial permutation cannot place every choice, so authored
          // order stands for both the base and the translated lists.
          if (permutation.length === baseChoices.length) {
            finalChoices = orderedBaseChoices;
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
        }

        const mergedTranslations = variant
          ? { ...questionTranslations, ...variantTranslations }
          : questionTranslations;

        // A stored translation was already put in the attempt's order above.
        // Only the authored stand-in still needs it; overwriting a real
        // translation here would serve choices the grader cannot match.
        if (
          !storedTranslation &&
          qv.randomizedChoices &&
          finalChoices.length > 0
        ) {
          primaryTranslation.translatedChoices = finalChoices;
        }

        const sanitizedChoices = this.sanitizeChoicesForDisplay(
          Array.isArray(primaryTranslation.translatedChoices)
            ? (primaryTranslation.translatedChoices as unknown as ExtendedChoice[])
            : this.parseChoices(
                primaryTranslation.translatedChoices || finalChoices,
              ),
        );

        // Raw choices go through: the learner shaper decides what to reveal.
        const sanitizedTranslations =
          this.withParsedTranslationChoices(mergedTranslations);
        return {
          id: originalQ.id,
          question: primaryTranslation.translatedText,
          choices: sanitizedChoices,
          translations: sanitizedTranslations,
          authorComment: null,
          maxWords: variant?.maxWords ?? originalQ?.maxWords,
          maxCharacters: variant?.maxCharacters ?? originalQ?.maxCharacters,
          scoring: this.preferParsedScoring(
            variant?.scoring,
            originalQ.scoring,
          ),
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
        const questionTranslations = this.withoutAuthoredLanguage(
          translations.has(questionKey)
            ? translations.get(questionKey) || {}
            : {},
        );

        const translationForLanguage = pickTranslation(
          questionTranslations,
          language,
        );

        const sanitizedChoices = this.sanitizeChoicesForDisplay(
          translationForLanguage?.translatedChoices
            ? this.parseChoices(translationForLanguage.translatedChoices)
            : this.parseChoices(originalQ.choices),
        );

        const sanitizedTranslations =
          this.withParsedTranslationChoices(questionTranslations);

        return {
          id: originalQ.id,
          question:
            translationForLanguage?.translatedText || originalQ.question,
          choices: sanitizedChoices,
          translations: sanitizedTranslations,
          authorComment: null,
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
   * English is the authored language: the grader compares a submitted choice
   * against the authored text and never applies a stored translation to it.
   * The catalogue nevertheless holds `en` rows — machine paraphrases of the
   * authored text — and serving one makes every English learner submit
   * choices the grader cannot match. Whatever is read here must agree with
   * the grader, so those rows are dropped before anything picks from them.
   *
   * @param translations - Stored translations keyed by language code
   * @returns The same map without any English entry
   */
  private static withoutAuthoredLanguage(
    translations: Record<string, TranslatedContent>,
  ): Record<string, TranslatedContent> {
    // Copies, so reordering below never mutates the caller's translation map.
    return Object.fromEntries(
      Object.entries(translations)
        .filter(([code]) => !this.isAuthoredLanguage(code))
        .map(([code, content]) => [
          code,
          {
            translatedText: content.translatedText,
            translatedChoices:
              this.parseOptionalChoices(content.translatedChoices) ?? undefined,
          },
        ]),
    );
  }

  /**
   * Stored translated choices: an array, or JSON text of one. Anything else
   * means the translation has no choices of its own.
   */
  private static parseOptionalChoices(
    choices: unknown,
  ): ExtendedChoice[] | null {
    if (Array.isArray(choices)) return choices as ExtendedChoice[];
    if (typeof choices !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(choices);
      return Array.isArray(parsed) ? (parsed as ExtendedChoice[]) : null;
    } catch {
      // Unparsable text carries no usable choices; fall back to authored.
      return null;
    }
  }

  private static isAuthoredLanguage(language: string): boolean {
    return language.trim().toLowerCase().split("-")[0] === "en";
  }

  /**
   * Build the stand-in used when the requested language has no translation for
   * a question or its variant: the authored text and choices, exactly as the
   * v1 attempt path does. Without it the caller dereferences `undefined` and
   * the whole attempt read fails with a 500 for every learner on that language.
   *
   * @param variant - The variant selected for this attempt, when there is one
   * @param originalQ - The authored question
   * @param baseChoices - The authored choices, already parsed
   * @param language - The language the learner asked for
   * @returns Untranslated content shaped like a translation
   */
  private static buildUntranslatedContent(
    variant: PrismaNestedVariant["questionVariant"],
    originalQ: Pick<AttemptQuestionDto, "id" | "question" | "assignmentId">,
    baseChoices: ExtendedChoice[],
    language: string,
  ): TranslatedContent {
    // The authored language never has anything to translate; only another
    // language arriving here means a translation is missing.
    if (!this.isAuthoredLanguage(language)) {
      logger.warn(
        `No translation for language=${language} questionId=${originalQ.id} ` +
          `variantId=${variant?.id ?? "none"} assignmentId=${originalQ.assignmentId}; ` +
          `serving authored content`,
      );
    }

    return {
      translatedText: variant?.variantContent || originalQ.question,
      translatedChoices: baseChoices,
    };
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
      .filter(
        (c): c is Choice =>
          !!c && (typeof c.choice === "string" || typeof c.choice === "number"),
      )
      .map((c) => ({
        id: c.id === undefined ? null : c.id,
        choice: typeof c.choice === "number" ? String(c.choice) : c.choice,
      }));
  }

  /**
   * Translations with `translatedChoices` as a parsed array or null. Choice
   * fields are left intact; the learner shaper strips them per visibility.
   */
  private static withParsedTranslationChoices(
    translations: Record<string, TranslatedContent>,
  ): Record<string, TranslatedContent> {
    const parsedTranslations: Record<string, TranslatedContent> = {};

    for (const [lang, content] of Object.entries(translations)) {
      parsedTranslations[lang] = {
        translatedText: content.translatedText,
        translatedChoices: this.parseOptionalChoices(content.translatedChoices),
      };
    }

    return parsedTranslations;
  }

  /**
   * The variant's scoring when it holds a value (stored text is parsed),
   * else the question's.
   */
  private static preferParsedScoring(
    variantScoring: unknown,
    questionScoring: unknown,
  ): ScoringDto | null {
    return (parseStoredJson(variantScoring) ??
      parseStoredJson(questionScoring)) as ScoringDto | null;
  }

  /**
   * Replace text and choices with the stored translation for the attempt's
   * language, when one exists.
   */
  private static async applyTranslations(
    questions: ServedQuestion[],
    prisma: PrismaService,
    language: string,
  ): Promise<void> {
    for (const question of questions) {
      const translation = await findQuestionTranslation(
        prisma,
        question.source.id,
        question.variantId,
        language,
      );

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

  private static reorderTranslatedChoices(
    translations: Record<string, TranslatedContent>,
    permutation: number[],
    originalChoices: ExtendedChoice[],
  ): void {
    if (permutation.length !== originalChoices.length) return;
    for (const lang in translations) {
      const translationObject = translations[lang];
      if (!translationObject) continue;
      const origTranslatedChoices = this.parseOptionalChoices(
        translationObject.translatedChoices,
      );
      if (
        origTranslatedChoices &&
        origTranslatedChoices.length === originalChoices.length
      ) {
        const reorderedTranslatedChoices = permutation.map(
          (index) => origTranslatedChoices[index],
        );

        translationObject.translatedChoices = reorderedTranslatedChoices;
      }
    }
  }
}
