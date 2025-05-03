/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { IGradingStrategy } from "../common/interfaces/grading-strategy.interface";
import { ChoiceGradingStrategy } from "../common/strategies/choice-grading.strategy";
import { FileGradingStrategy } from "../common/strategies/file-grading.strategy";
import { PresentationGradingStrategy } from "../common/strategies/presentation-grading.strategy";
import { TextGradingStrategy } from "../common/strategies/text-grading.strategy";
import { TrueFalseGradingStrategy } from "../common/strategies/true-false-grading.strategy";
import { UrlGradingStrategy } from "../common/strategies/url-grading.strategy";

/**
 * Factory service for getting the appropriate grading strategy based on question type
 */
@Injectable()
export class GradingFactoryService {
  constructor(
    private readonly textGradingStrategy: TextGradingStrategy,
    private readonly fileGradingStrategy: FileGradingStrategy,
    private readonly urlGradingStrategy: UrlGradingStrategy,
    private readonly presentationGradingStrategy: PresentationGradingStrategy,
    private readonly choiceGradingStrategy: ChoiceGradingStrategy,
    private readonly trueFalseGradingStrategy: TrueFalseGradingStrategy,
  ) {}

  /**
   * Get the appropriate grading strategy for a question type
   * @param questionType The type of question
   * @param responseType Optional response type for further disambiguation
   * @returns The appropriate grading strategy
   */
  getStrategy(
    questionType: QuestionType | undefined,
    responseType?: string,
  ): IGradingStrategy {
    if (questionType === undefined) {
      throw new Error(
        "No grading strategy available for undefined question type",
      );
    }
    switch (questionType) {
      case QuestionType.TEXT: {
        return this.textGradingStrategy;
      }

      case QuestionType.UPLOAD: {
        if (
          responseType === "LIVE_RECORDING" ||
          responseType === "PRESENTATION"
        ) {
          return this.presentationGradingStrategy;
        }
        return this.fileGradingStrategy;
      }

      case QuestionType.URL: {
        return this.urlGradingStrategy;
      }

      case QuestionType.LINK_FILE: {
        // Handle the mixed type based on the response that will be provided
        // We'll let the QuestionResponseService decide which one to use
        return null;
      }

      case QuestionType.TRUE_FALSE: {
        return this.trueFalseGradingStrategy;
      }

      case QuestionType.SINGLE_CORRECT:
      case QuestionType.MULTIPLE_CORRECT: {
        return this.choiceGradingStrategy;
      }
    }
  }
}
