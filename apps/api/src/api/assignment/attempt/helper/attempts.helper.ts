/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import { fetchUrlContentForGrading } from "../../../attempt/common/utils/github-content-fetch.util";
import { ChoiceBasedQuestionResponseModel } from "../../../llm/model/choice.based.question.response.model";
import { FileBasedQuestionResponseModel } from "../../../llm/model/file.based.question.response.model";
import { TextBasedQuestionResponseModel } from "../../../llm/model/text.based.question.response.model";
import { TrueFalseBasedQuestionResponseModel } from "../../../llm/model/true.false.based.question.response.model";
import { UrlBasedQuestionResponseModel } from "../../../llm/model/url.based.question.response.model";
import {
  buildLearnerStructuredFeedback,
  sanitizeLearnerFeedback,
} from "../../../llm/features/grading/utils/learner-feedback.util";
import { CreateQuestionResponseAttemptRequestDto } from "../dto/question-response/create.question.response.attempt.request.dto";
import {
  ChoiceBasedFeedbackDto,
  CreateQuestionResponseAttemptResponseDto,
  GeneralFeedbackDto,
  TrueFalseBasedFeedbackDto,
} from "../dto/question-response/create.question.response.attempt.response.dto";

export const AttemptHelper = {
  assignFeedbackToResponse(
    model:
      | UrlBasedQuestionResponseModel
      | TextBasedQuestionResponseModel
      | ChoiceBasedQuestionResponseModel
      | TrueFalseBasedQuestionResponseModel
      | FileBasedQuestionResponseModel,
    responseDto: CreateQuestionResponseAttemptResponseDto,
  ) {
    responseDto.totalPoints = model.points;

    if (model instanceof ChoiceBasedQuestionResponseModel) {
      responseDto.feedback = model.feedback as ChoiceBasedFeedbackDto[];
    } else if (model instanceof TrueFalseBasedQuestionResponseModel) {
      responseDto.feedback = [
        {
          choice: model.choice,
          feedback: model.feedback,
        },
      ] as TrueFalseBasedFeedbackDto[];
    } else if (model instanceof FileBasedQuestionResponseModel) {
      const generalFeedbackDto = new GeneralFeedbackDto();
      generalFeedbackDto.feedback = sanitizeLearnerFeedback(model.feedback);

      if (model.rubricScores?.length) {
        generalFeedbackDto.structuredFeedback = buildLearnerStructuredFeedback(
          model.points,
          model.rubricScores,
          model.feedback,
        );
      }

      if ((model as any).highlighting) {
        generalFeedbackDto.highlighting = (model as any).highlighting;
      }

      if ((model as any).annotatedPdfUrl) {
        generalFeedbackDto.annotatedPdfUrl = (model as any).annotatedPdfUrl;
      }

      if (
        !generalFeedbackDto.structuredFeedback &&
        (model.analysis ||
          model.evaluation ||
          model.explanation ||
          model.guidance)
      ) {
        const feedbackLower = generalFeedbackDto.feedback.toLowerCase();
        const hasExistingStructure =
          feedbackLower.includes("analysis:") ||
          feedbackLower.includes("evaluation:") ||
          feedbackLower.includes("explanation:") ||
          feedbackLower.includes("guidance:");

        if (!hasExistingStructure) {
          let aeegSection = "\n\n**Detailed Breakdown:**\n";
          if (model.analysis) {
            aeegSection += `\n**Analysis:** ${model.analysis}\n`;
          }
          if (model.evaluation) {
            aeegSection += `\n**Evaluation:** ${model.evaluation}\n`;
          }
          if (model.explanation) {
            aeegSection += `\n**Explanation:** ${model.explanation}\n`;
          }
          if (model.guidance) {
            aeegSection += `\n**Guidance:** ${model.guidance}\n`;
          }
          generalFeedbackDto.feedback += aeegSection;
        }
      }

      responseDto.feedback = [generalFeedbackDto];

      if (model.rubricScores && model.rubricScores.length > 0) {
        responseDto.metadata = {
          ...responseDto.metadata,
          rubricScores: model.rubricScores,
          hasDetailedRubrics: true,
          rubricCount: model.rubricScores.length,
        };
      }

      if ((model as any).metadata) {
        responseDto.metadata = {
          ...responseDto.metadata,
          ...(model as any).metadata,
        };
      }
    } else if (model instanceof TextBasedQuestionResponseModel) {
      const generalFeedbackDto = new GeneralFeedbackDto();
      generalFeedbackDto.feedback = sanitizeLearnerFeedback(model.feedback);

      if (model.rubricScores?.length) {
        generalFeedbackDto.structuredFeedback = buildLearnerStructuredFeedback(
          model.points,
          model.rubricScores,
          model.feedback,
        );
      } else if (model.structuredFeedback) {
        generalFeedbackDto.structuredFeedback = {
          ...model.structuredFeedback,
          summary: sanitizeLearnerFeedback(model.structuredFeedback.summary),
          guidance: sanitizeLearnerFeedback(model.structuredFeedback.guidance),
          criteria: model.structuredFeedback.criteria.map((criterion) => ({
            ...criterion,
            name: sanitizeLearnerFeedback(criterion.name),
            evidence: sanitizeLearnerFeedback(criterion.evidence),
            feedback: sanitizeLearnerFeedback(criterion.feedback),
            nextStep: sanitizeLearnerFeedback(criterion.nextStep),
          })),
        };
      }

      if (
        !generalFeedbackDto.structuredFeedback &&
        (model.analysis ||
          model.evaluation ||
          model.explanation ||
          model.guidance)
      ) {
        const feedbackLower = generalFeedbackDto.feedback.toLowerCase();
        const hasExistingStructure =
          feedbackLower.includes("analysis:") ||
          feedbackLower.includes("evaluation:") ||
          feedbackLower.includes("explanation:") ||
          feedbackLower.includes("guidance:");

        if (!hasExistingStructure) {
          let aeegSection = "\n\n**Detailed Breakdown:**\n";
          if (model.analysis) {
            aeegSection += `\n**Analysis:** ${model.analysis}\n`;
          }
          if (model.evaluation) {
            aeegSection += `\n**Evaluation:** ${model.evaluation}\n`;
          }
          if (model.explanation) {
            aeegSection += `\n**Explanation:** ${model.explanation}\n`;
          }
          if (model.guidance) {
            aeegSection += `\n**Guidance:** ${model.guidance}\n`;
          }
          generalFeedbackDto.feedback += aeegSection;
        }
      }
      responseDto.feedback = [generalFeedbackDto];

      if (model.rubricScores && model.rubricScores.length > 0) {
        responseDto.metadata = {
          ...responseDto.metadata,
          rubricScores: model.rubricScores,
          hasDetailedRubrics: true,
          rubricCount: model.rubricScores.length,
        };
      }

      if (model.metadata) {
        responseDto.metadata = {
          ...responseDto.metadata,
          ...model.metadata,
        };
      }
    } else {
      const generalFeedbackDto = new GeneralFeedbackDto();
      generalFeedbackDto.feedback = sanitizeLearnerFeedback(model.feedback);
      responseDto.feedback = [generalFeedbackDto];

      if ((model as any).metadata) {
        responseDto.metadata = {
          ...responseDto.metadata,
          ...(model as any).metadata,
        };
      }
    }
  },

  validateAndGetTextResponse(
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    if (questionType === QuestionType.TEXT) {
      if (!createQuestionResponseAttemptRequestDto.learnerTextResponse) {
        throw new BadRequestException(
          "Expected a text-based response (learnerResponse), but did not receive one.",
        );
      }
      return Promise.resolve(
        createQuestionResponseAttemptRequestDto.learnerTextResponse,
      );
    }
    throw new BadRequestException("Unexpected question type received.");
  },
  shuffleJsonArray<T>(array: T[]): T[] {
    for (let index = array.length - 1; index > 0; index--) {
      const index_ = Math.floor(Math.random() * (index + 1));
      [array[index], array[index_]] = [array[index_], array[index]];
    }
    return array;
  },
  async fetchPlainTextFromUrl(
    url: string,
  ): Promise<{ body: string; isFunctional: boolean }> {
    return fetchUrlContentForGrading(url);
  },
};
