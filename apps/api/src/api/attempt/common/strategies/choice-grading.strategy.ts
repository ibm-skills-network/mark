/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
} from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import {
  Choice,
  QuestionDto,
} from "src/api/assignment/dto/update.questions.request.dto";
import { ScoringType } from "src/api/assignment/question/dto/create.update.question.request.dto";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import {
  ChoiceRendering,
  resolveChoiceAcrossRenderings,
} from "../utils/choice-renderings.util";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class ChoiceGradingStrategy extends AbstractGradingStrategy<string[]> {
  constructor(
    protected readonly localizationService: LocalizationService,
    @Inject(GRADING_AUDIT_SERVICE)
    protected readonly gradingAuditService: GradingAuditService,
    @Optional() @Inject(WINSTON_MODULE_PROVIDER) parentLogger?: Logger,
  ) {
    super(
      localizationService,
      gradingAuditService,
      undefined,
      undefined,
      parentLogger,
    );
  }

  /**
   * Handle both single-choice and multiple-choice questions
   */
  async handleResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    if (question.type === QuestionType.SINGLE_CORRECT) {
      return this.handleSingleChoice(question, requestDto, context);
    } else if (question.type === QuestionType.MULTIPLE_CORRECT) {
      return this.handleMultipleChoice(question, requestDto, context);
    } else {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "unsupportedChoiceType",
          context.language,
          { type: question.type },
        ),
      );
    }
  }

  /**
   * Validate response for choice-based questions
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      question.type === QuestionType.SINGLE_CORRECT &&
      requestDto.learnerChoices &&
      requestDto.learnerChoices.length > 1
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "tooManyChoicesSelected",
          requestDto.language,
          { max: 1 },
        ),
      );
    }

    return true;
  }

  /**
   * Extract learner choices from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string[]> {
    const { learnerChoices } = requestDto;

    if (!Array.isArray(learnerChoices)) {
      return [];
    }

    return learnerChoices
      .filter((choice) => choice !== null && choice !== undefined)
      .map((choice) => this.coerceToString(choice));
  }

  /**
   * Implement the required gradeResponse method from the interface
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let responseDto: CreateQuestionResponseAttemptResponseDto;

    if (question.type === QuestionType.SINGLE_CORRECT) {
      const result = await this.gradeSingleChoice(
        question,
        learnerResponse,
        context,
      );
      responseDto = result.responseDto;
    } else if (question.type === QuestionType.MULTIPLE_CORRECT) {
      const result = await this.gradeMultipleChoice(
        question,
        learnerResponse,
        context,
      );
      responseDto = result.responseDto;
    } else {
      throw new BadRequestException(
        `Unsupported choice question type: ${question.type}`,
      );
    }

    return responseDto;
  }

  /**
   * Handle single choice questions
   */
  private async handleSingleChoice(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    await this.validateResponse(question, requestDto);

    const learnerResponse = await this.extractLearnerResponse(requestDto);

    return this.gradeSingleChoice(question, learnerResponse, context);
  }

  /**
   * Grade a single choice question
   */
  private async gradeSingleChoice(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    const choices = this.parseChoices(question.choices);

    if (!learnerResponse || learnerResponse.length === 0) {
      const responseDto = this.createResponseDto(0, [
        {
          choice: "",
          feedback: this.localizationService.getLocalizedString(
            "noOptionSelected",
            context.language,
          ),
        } as ChoiceBasedFeedbackDto,
      ]);

      return { responseDto, learnerResponse: [] };
    }

    const learnerChoice = learnerResponse[0];
    const normalizedLearnerChoice = this.normalizeText(learnerChoice);
    const correctChoice = choices.find((choice) => choice.isCorrect);

    const selectedChoice =
      choices.find(
        (choice) =>
          this.normalizeText(choice.choice) === normalizedLearnerChoice,
      ) ??
      (await this.resolveOutsideGradingLanguage(
        question,
        choices,
        learnerChoice,
        context,
        { alignedOnly: false },
      ));

    const data = {
      learnerChoice,
      correctChoice: correctChoice?.choice,
      points: selectedChoice ? selectedChoice.points : 0,
    };

    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (selectedChoice) {
      let choiceFeedback = "";
      if (selectedChoice.feedback) {
        choiceFeedback = this.formatFeedback(selectedChoice.feedback, data);
      } else {
        choiceFeedback = selectedChoice.isCorrect
          ? this.localizationService.getLocalizedString(
              "correctSelection",
              context.language,
              data,
            )
          : this.localizationService.getLocalizedString(
              "incorrectSelection",
              context.language,
              data,
            );
      }

      responseDto.totalPoints = selectedChoice.isCorrect
        ? selectedChoice.points
        : 0;

      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: choiceFeedback,
        },
      ] as ChoiceBasedFeedbackDto[];

      responseDto.metadata = {
        isCorrect: selectedChoice.isCorrect,
        correctChoice: correctChoice?.choice,
        possiblePoints: selectedChoice.points,
        scoredPoints: responseDto.totalPoints,
        maxPossiblePoints: question.totalPoints,
      };
    } else {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: learnerChoice,
          feedback: this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        },
      ] as ChoiceBasedFeedbackDto[];

      responseDto.metadata = {
        isCorrect: false,
        error: "invalidSelection",
        correctChoice: correctChoice?.choice,
        maxPossiblePoints: question.totalPoints,
      };
    }

    return { responseDto, learnerResponse };
  }

  /**
   * Handle multiple choice questions
   */
  private async handleMultipleChoice(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    await this.validateResponse(question, requestDto);

    const learnerResponse = await this.extractLearnerResponse(requestDto);

    return this.gradeMultipleChoice(question, learnerResponse, context);
  }

  /**
   * Grade a multiple choice question
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async gradeMultipleChoice(
    question: QuestionDto,
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<{
    responseDto: CreateQuestionResponseAttemptResponseDto;
    learnerResponse: string[];
  }> {
    const responseDto = new CreateQuestionResponseAttemptResponseDto();

    if (!learnerResponse || learnerResponse.length === 0) {
      responseDto.totalPoints = 0;
      responseDto.feedback = [
        {
          choice: [],
          feedback: this.localizationService.getLocalizedString(
            "noOptionSelected",
            context.language,
          ),
        },
      ] as unknown as ChoiceBasedFeedbackDto[];

      return { responseDto, learnerResponse: [] };
    }

    const choices = this.parseChoices(question.choices);
    const gradedLearnerChoices = await this.mapChoicesToGradingLanguage(
      question,
      choices,
      learnerResponse,
      context,
    );

    const normalizedLearnerChoices = new Set(
      gradedLearnerChoices.map((choice) => this.normalizeText(choice)),
    );

    const normalizedChoices = choices.map((choice) => ({
      original: choice,
      normalized: this.normalizeText(choice.choice),
    }));

    const correctChoices = choices.filter((choice) => choice.isCorrect) || [];
    const correctChoiceTexts = correctChoices.map((choice) =>
      this.normalizeText(choice.choice),
    );

    let totalPoints = 0;
    const feedbackDetails: string[] = [];
    const selectedChoices: Choice[] = [];

    for (const learnerChoice of gradedLearnerChoices) {
      const normalizedLearnerChoice = this.normalizeText(learnerChoice);
      const matchedChoice = normalizedChoices.find(
        (item) => item.normalized === normalizedLearnerChoice,
      );

      if (matchedChoice) {
        selectedChoices.push({
          choice: matchedChoice.original.choice,
          isCorrect: matchedChoice.original.isCorrect,
          points: matchedChoice.original.points || 0,
          feedback: matchedChoice.original.feedback,
        });

        if (matchedChoice.original.isCorrect) {
          totalPoints += matchedChoice.original.points || 0;
        } else if (question.scoring?.type === ScoringType.LOSS_PER_MISTAKE) {
          totalPoints -= matchedChoice.original.points || 0;
        }

        const data = {
          learnerChoice,
          points: matchedChoice.original.points || 0,
        };

        let choiceFeedback = "";
        if (matchedChoice.original.feedback) {
          choiceFeedback = this.formatFeedback(
            matchedChoice.original.feedback,
            data,
          );
        } else {
          choiceFeedback = matchedChoice.original.isCorrect
            ? this.localizationService.getLocalizedString(
                "correctSelection",
                context.language,
                data,
              )
            : this.localizationService.getLocalizedString(
                "incorrectSelection",
                context.language,
                data,
              );
        }

        feedbackDetails.push(choiceFeedback);
      } else {
        selectedChoices.push({
          choice: learnerChoice,
          isCorrect: false,
          points: 0,
          feedback: this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        });

        feedbackDetails.push(
          this.localizationService.getLocalizedString(
            "invalidSelection",
            context.language,
            { learnerChoice },
          ),
        );
      }
    }

    const maxPoints = correctChoices.reduce(
      (accumulator, choice) => accumulator + (choice.points || 0),
      0,
    );

    // The question's own maximum is authoritative: it is the value used by
    // the grade denominator, the attempt point total, the learner score
    // line, and the LTI passback. The sum of the correct choices' points can
    // exceed that maximum (e.g. a 1-point question with two 1-point correct
    // choices), so capping only at `maxPoints` lets a single question award
    // more than 100% of its worth and mask other questions' losses in the
    // attempt total. Fall back to `maxPoints` only when the question carries
    // no usable maximum of its own (totalPoints is optional for
    // MULTIPLE_CORRECT).
    const questionMax =
      typeof question.totalPoints === "number"
        ? question.totalPoints
        : maxPoints;

    const finalPoints = Math.max(0, Math.min(totalPoints, questionMax));

    const allCorrectSelected: boolean = correctChoiceTexts.every(
      (correctText) => normalizedLearnerChoices.has(correctText),
    );

    const noIncorrectSelected: boolean = [...normalizedLearnerChoices].every(
      (learnerChoice: string) => correctChoiceTexts.includes(learnerChoice),
    );

    const perfectScore: boolean = allCorrectSelected && noIncorrectSelected;

    const feedbackMessage = `
      ${feedbackDetails.join(".\n")}.
      ${
        perfectScore
          ? this.localizationService.getLocalizedString(
              "allCorrectSelected",
              context.language,
            )
          : this.localizationService.getLocalizedString(
              "correctOptions",
              context.language,
              {
                correctOptions: correctChoices
                  .map((choice) => choice.choice)
                  .join(", "),
              },
            )
      }
    `;

    responseDto.totalPoints = finalPoints;
    responseDto.feedback = [
      {
        choice: learnerResponse.join(", "),
        feedback: feedbackMessage.trim(),
      },
    ];

    responseDto.metadata = {
      selectedChoices,
      correctChoices: correctChoices.map((c) => c.choice),
      maxPoints,
      actualPoints: totalPoints,
      finalPoints,
      perfectScore,
      allCorrectSelected,
      noIncorrectSelected,
      maxPossiblePoints: question.totalPoints,
    };

    return { responseDto, learnerResponse };
  }

  /**
   * Find the choice a learner meant when the submitted text is not in the
   * grading language's set. The learner client submits the text of whatever
   * language it last rendered, which can differ from the `language` the
   * submit names, so every stored rendering of the question is consulted.
   * Returns undefined when nothing matches or the match is ambiguous; the
   * caller then grades the text as an invalid selection, as before.
   */
  private async resolveOutsideGradingLanguage(
    question: QuestionDto,
    gradingChoices: Choice[],
    learnerChoice: unknown,
    context: GradingContext,
    options: { alignedOnly: boolean },
    renderings?: ChoiceRendering[],
  ): Promise<Choice | undefined> {
    if (!context.loadChoiceRenderings && !renderings) return undefined;

    const available =
      renderings ?? (await this.loadChoiceRenderings(question, context));
    const resolution = resolveChoiceAcrossRenderings(
      learnerChoice,
      gradingChoices,
      available,
      options,
    );

    const logContext = {
      questionId: question.id,
      attemptId: context.attemptId,
      assignmentId: context.assignmentId,
      language: context.language,
      questionType: question.type,
    };

    if (resolution.kind === "matched") {
      this.logger?.info(
        "Matched a submitted choice outside the grading language",
        {
          ...logContext,
          sources: resolution.sources,
          gradingIndex: resolution.gradingIndex,
          isCorrect: resolution.choice.isCorrect === true,
        },
      );
      return resolution.choice;
    }

    if (resolution.kind === "ambiguous") {
      this.logger?.warn(
        "Submitted choice matches choices that score differently; grading it as an invalid selection",
        { ...logContext, sources: resolution.sources },
      );
    }

    return undefined;
  }

  /**
   * Rewrite each submitted choice of a multiple-correct question to the
   * grading language's text, so the scoring below compares like with like.
   * Only renderings in the grading set's own order are used: this scoring
   * tracks which grading choices were picked. A choice picked twice (for
   * example once per language) counts once.
   */
  private async mapChoicesToGradingLanguage(
    question: QuestionDto,
    gradingChoices: Choice[],
    learnerResponse: string[],
    context: GradingContext,
  ): Promise<string[]> {
    const known = new Set(
      gradingChoices.map((choice) => this.normalizeText(choice.choice)),
    );
    let renderings: ChoiceRendering[] | undefined;
    const mapped: string[] = [];
    const seen = new Set<string>();

    for (const learnerChoice of learnerResponse) {
      let text = learnerChoice;
      if (!known.has(this.normalizeText(learnerChoice))) {
        if (context.loadChoiceRenderings && renderings === undefined) {
          renderings = await this.loadChoiceRenderings(question, context);
        }
        const resolved = await this.resolveOutsideGradingLanguage(
          question,
          gradingChoices,
          learnerChoice,
          context,
          { alignedOnly: true },
          renderings,
        );
        if (resolved) {
          text = this.coerceToString(resolved.choice);
        }
      }

      const key = this.normalizeText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      mapped.push(text);
    }

    return mapped;
  }

  /**
   * Load the stored renderings of the question's choices. A failed read is
   * logged and grading continues against the grading language alone, which
   * is how every submission was graded before the lookup existed.
   */
  private async loadChoiceRenderings(
    question: QuestionDto,
    context: GradingContext,
  ): Promise<ChoiceRendering[]> {
    if (!context.loadChoiceRenderings) return [];
    try {
      return await context.loadChoiceRenderings();
    } catch (error: unknown) {
      this.logger?.error(
        "Could not load stored choice renderings; grading against the submit language only",
        {
          questionId: question.id,
          attemptId: context.attemptId,
          assignmentId: context.assignmentId,
          language: context.language,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
      );
      return [];
    }
  }

  /**
   * Parse choices from any format into an array of Choice objects
   */
  private parseChoices(choices: unknown): Choice[] {
    if (!choices) {
      return [];
    }

    if (typeof choices === "string") {
      try {
        return JSON.parse(choices) as Choice[];
      } catch {
        return [];
      }
    }

    return choices as Choice[];
  }

  /**
   * Normalize text for comparison (lowercase, trim, remove punctuation)
   */
  private normalizeText(text: unknown): string {
    const normalized = this.coerceToString(text);

    if (!normalized) {
      return "";
    }

    return normalized
      .trim()
      .toLowerCase()
      .replaceAll(/[!,،؛؟]/g, "");
  }

  /**
   * Safely convert different learner response representations to string
   */
  private coerceToString(value: unknown): string {
    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "bigint"
    ) {
      return String(value);
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const candidateKeys = [
        "choice",
        "value",
        "label",
        "text",
        "name",
        "title",
      ];
      for (const key of candidateKeys) {
        if (!(key in record)) {
          continue;
        }

        const candidate = record[key];
        if (candidate === value) {
          continue;
        }

        if (typeof candidate === "string") {
          return candidate;
        }

        if (
          typeof candidate === "number" ||
          typeof candidate === "boolean" ||
          typeof candidate === "bigint"
        ) {
          return String(candidate);
        }

        if (candidate && typeof candidate === "object") {
          const nested = this.coerceToString(candidate);
          if (nested) {
            return nested;
          }
        }
      }

      const firstStringValue = Object.values(record).find(
        (entry) => typeof entry === "string",
      );

      if (firstStringValue) {
        return firstStringValue;
      }

      if (
        typeof (value as { toString?: () => string }).toString === "function"
      ) {
        const stringValue = (value as { toString?: () => string }).toString();

        if (
          typeof stringValue === "string" &&
          stringValue !== "[object Object]"
        ) {
          return stringValue;
        }
      }
    }

    return "";
  }

  /**
   * Format a feedback string with placeholder replacements
   */
  private formatFeedback(
    feedbackTemplate: string,
    data: { [key: string]: any },
  ): string {
    return feedbackTemplate.replaceAll(/\${(.*?)}/g, (_, g: string) =>
      String(data[g] || ""),
    );
  }
}
