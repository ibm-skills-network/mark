/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException, Logger } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import * as cheerio from "cheerio";
import { safeGet } from "../../../attempt/common/utils/ssrf-safe-http";
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

const logger = new Logger("AttemptHelper");

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
    const MAX_CONTENT_SIZE = 100_000;
    try {
      if (url.includes("github.com")) {
        if (url.includes("/blob/")) {
          const rawUrl = convertGitHubUrlToRaw(url);
          if (!rawUrl) {
            return { body: "", isFunctional: false };
          }

          const rawContentResponse = await safeGet<string>(rawUrl);
          if (rawContentResponse.status === 200) {
            let body = rawContentResponse.data;
            if (body.length > MAX_CONTENT_SIZE) {
              body = body.slice(0, MAX_CONTENT_SIZE);
            }
            return { body, isFunctional: true };
          }
        } else {
          try {
            const repoMatch = url.match(
              /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/,
            );
            if (repoMatch) {
              const [, user, repo] = repoMatch;

              const readmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/README.md`;
              try {
                const readmeResponse = await safeGet<string>(readmeUrl);
                if (readmeResponse.status === 200) {
                  let body = readmeResponse.data;
                  if (body.length > MAX_CONTENT_SIZE) {
                    body = body.slice(0, MAX_CONTENT_SIZE);
                  }
                  return { body, isFunctional: true };
                }
              } catch {
                try {
                  const masterReadmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/master/README.md`;
                  const masterReadmeResponse =
                    await safeGet<string>(masterReadmeUrl);
                  if (masterReadmeResponse.status === 200) {
                    let body = masterReadmeResponse.data;
                    if (body.length > MAX_CONTENT_SIZE) {
                      body = body.slice(0, MAX_CONTENT_SIZE);
                    }
                    return { body, isFunctional: true };
                  }
                } catch {
                  const apiUrl = `https://api.github.com/repos/${user}/${repo}`;
                  try {
                    const apiResponse = await safeGet<{
                      full_name?: string;
                      description?: string;
                      stargazers_count?: number;
                      forks_count?: number;
                      language?: string;
                      updated_at?: string;
                    }>(apiUrl);
                    if (apiResponse.status === 200) {
                      const repoInfo = apiResponse.data;
                      const body = `Repository: ${
                        repoInfo.full_name
                      }\nDescription: ${
                        repoInfo.description || "No description"
                      }\nStars: ${repoInfo.stargazers_count}\nForks: ${
                        repoInfo.forks_count
                      }\nLanguage: ${
                        repoInfo.language || "Not specified"
                      }\nLast Updated: ${repoInfo.updated_at}`;
                      return { body, isFunctional: true };
                    }
                  } catch {
                    logger.warn(
                      `Failed to fetch README or repository info for ${user}/${repo}. URL may be non-functional or rate-limited.`,
                    );
                  }
                }
              }
            }
          } catch {
            logger.warn(
              `Failed to fetch repository info for ${url}. URL may be non-functional or rate-limited.`,
            );
          }

          try {
            const response = await safeGet<string>(url);
            const $ = cheerio.load(response.data);

            $(
              "script, style, noscript, iframe, noembed, embed, object",
            ).remove();

            let content = "";
            const readmeElement = $("article.markdown-body");
            if (readmeElement.length > 0) {
              content = readmeElement.text().trim();
            } else {
              const aboutSection = $(".Box-body");
              if (aboutSection.length > 0) {
                content += aboutSection.text().trim() + "\n\n";
              }

              const fileList = $(
                "div.js-details-container div.js-navigation-container tr.js-navigation-item",
              );
              if (fileList.length > 0) {
                content += "Repository Files:\n";
                fileList.each((_, element) => {
                  const fileName = $(element)
                    .find(".js-navigation-open")
                    .text()
                    .trim();
                  if (fileName) {
                    content += `- ${fileName}\n`;
                  }
                });
              }
            }

            if (content) {
              return {
                body: content.replaceAll(/\s+/g, " ").trim(),
                isFunctional: true,
              };
            }
          } catch {
            logger.warn(
              `Failed to fetch content from ${url}. URL may be non-functional or rate-limited.`,
            );
          }
        }

        return { body: "", isFunctional: false };
      } else {
        const response = await safeGet<string>(url);
        const $ = cheerio.load(response.data);

        $("script, style, noscript, iframe, noembed, embed, object").remove();

        const plainText = $("body")
          .text()
          .trim()
          // eslint-disable-next-line unicorn/prefer-string-replace-all
          .replace(/\s+/g, " ");

        return { body: plainText, isFunctional: true };
      }
    } catch {
      return { body: "", isFunctional: false };
    }
  },
};
function convertGitHubUrlToRaw(url: string): string | null {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
  );
  if (!match) {
    // eslint-disable-next-line unicorn/no-null
    return null;
  }
  const [, user, repo, path] = match;
  return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
}
