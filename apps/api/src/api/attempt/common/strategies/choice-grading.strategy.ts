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

    console.log("request dto:", requestDto);

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
    console.log("learner response:", learnerResponse);
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
    console.log("learner response:", learnerResponse);
    const normalizedLearnerChoice = this.normalizeText(learnerChoice);
    const correctChoice = choices.find((choice) => choice.isCorrect);

    console.log("learner choice:", normalizedLearnerChoice);
    console.log(
      "all choices:",
      choices.map((c) => c.choice),
    );

    console.log(
      "correct answer:",
      correctChoice ? correctChoice.choice : "none",
    );

    const selectedChoice = choices.find(
      (choice) => this.normalizeText(choice.choice) === normalizedLearnerChoice,
    );
    console.log("selected choice:", selectedChoice);

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

    const normalizedLearnerChoices = new Set(
      learnerResponse.map((choice) => this.normalizeText(choice)),
    );

    const choices = this.parseChoices(question.choices);
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

    for (const learnerChoice of learnerResponse) {
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

    const finalPoints = Math.max(0, Math.min(totalPoints, maxPoints));

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
    };

    return { responseDto, learnerResponse };
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
      .replaceAll(/[!,.،؛؟]/g, "");
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
