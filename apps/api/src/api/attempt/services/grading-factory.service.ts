/* eslint-disable unicorn/no-null */
import { Injectable } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { IGradingStrategy } from "../common/interfaces/grading-strategy.interface";
import { ChoiceGradingStrategy } from "../common/strategies/choice-grading.strategy";
import { FileGradingStrategy } from "../common/strategies/file-grading.strategy";
import {
  GRADABLE_IMAGE_EXTENSIONS,
  ImageGradingStrategy,
} from "../common/strategies/image-grading.strategy";

/** The minimal slice of an uploaded file that routing decisions read. */
export interface SubmittedFileForRouting {
  filename?: string;
  githubUrl?: string;
}
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
    private readonly imageGradingStrategy: ImageGradingStrategy,
  ) {}

  /**
   * Get the appropriate grading strategy for a question type
   * @param questionType The type of question
   * @param responseType Optional response type for further disambiguation
   * @param learnerFiles The submitted files, when the response has any; lets
   *   an all-image submission reach the vision strategy even on questions
   *   whose declared responseType is a document type
   * @returns The appropriate grading strategy
   */
  getStrategy(
    questionType: QuestionType | undefined,
    responseType?: string,
    learnerFiles?: SubmittedFileForRouting[],
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
        } else if (
          responseType === "IMAGES" ||
          this.isImageOnlySubmission(learnerFiles)
        ) {
          return this.imageGradingStrategy;
        }
        return this.fileGradingStrategy;
      }

      case QuestionType.URL: {
        return this.urlGradingStrategy;
      }

      case QuestionType.LINK_FILE: {
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

  /**
   * True when every submitted file is a raster image the vision pipeline can
   * grade. Questions authored with a document responseType routinely receive
   * screenshot answers; the file strategy grades those from extracted text —
   * which for pixels is nothing — so an all-image submission must reach the
   * image strategy regardless of the declared responseType. Mixed submissions
   * keep the file path: it is the only strategy that can read the non-image
   * files, and its handling of them is unchanged.
   */
  private isImageOnlySubmission(
    learnerFiles?: SubmittedFileForRouting[],
  ): boolean {
    if (!learnerFiles || learnerFiles.length === 0) {
      return false;
    }
    return learnerFiles.every((file) => {
      if (file.githubUrl) {
        return false;
      }
      const extension = file.filename?.split(".").pop()?.toLowerCase() ?? "";
      return GRADABLE_IMAGE_EXTENSIONS.has(extension);
    });
  }
}
