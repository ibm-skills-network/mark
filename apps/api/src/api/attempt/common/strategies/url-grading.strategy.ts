/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import axios from "axios";
import * as cheerio from "cheerio";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { Logger } from "winston";
import { GRADING_AUDIT_SERVICE } from "../../attempt.constants";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class UrlGradingStrategy extends AbstractGradingStrategy<string> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
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
   * Validate that the request contains a valid URL
   */
  async validateResponse(
    question: QuestionDto,
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<boolean> {
    if (
      !requestDto.learnerUrlResponse ||
      requestDto.learnerUrlResponse.trim() === ""
    ) {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "expectedUrlResponse",
          requestDto.language,
        ),
      );
    }

    try {
      new URL(requestDto.learnerUrlResponse);
    } catch {
      throw new BadRequestException(
        this.localizationService.getLocalizedString(
          "invalidUrl",
          requestDto.language,
          { url: requestDto.learnerUrlResponse },
        ),
      );
    }

    return true;
  }

  /**
   * Extract the URL response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    return requestDto.learnerUrlResponse.trim();
  }

  /**
   * Grade the URL response using LLM
   */
  async gradeResponse(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
  ): Promise<CreateQuestionResponseAttemptResponseDto> {
    let urlFetchResponse: { body: string; isFunctional: boolean };

    try {
      urlFetchResponse = await this.fetchUrlContent(learnerResponse);
    } catch {
      urlFetchResponse =
        await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
    }

    if (!urlFetchResponse.isFunctional) {
      const responseDto = this.createResponseDto(0, [
        {
          feedback: this.localizationService.getLocalizedString(
            "unableToFetchUrl",
            context.language,
            { url: learnerResponse },
          ),
        },
      ]);

      responseDto.metadata = {
        error: "url_fetch_failed",
        url: learnerResponse,
        status: "error",
      };

      await this.recordGrading(
        question,
        {
          learnerUrlResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "UrlGradingStrategy-Failed",
      );

      return responseDto;
    }

    const urlBasedQuestionEvaluateModel = new UrlBasedQuestionEvaluateModel(
      question.question,
      context.questionAnswerContext,
      context.assignmentInstructions,
      learnerResponse,
      urlFetchResponse.isFunctional,
      JSON.stringify(urlFetchResponse.body),
      question.totalPoints,
      question.scoring?.type ?? "",
      question.scoring,
      question.responseType ?? "OTHER",
    );

    const gradingModel = await this.llmFacadeService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
      context.assignmentId,
      context.language,
    );

    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    responseDto.metadata = {
      ...responseDto.metadata,
      url: learnerResponse,
      contentSummary: this.summarizeContent(urlFetchResponse.body),
      contentLength: urlFetchResponse.body.length,
      isGithubRepo: learnerResponse.includes("github.com"),
      gradingRationale:
        gradingModel.gradingRationale || "URL content evaluated",
    };

    // Record grading for audit and consistency (successful case)
    await this.recordGrading(
      question,
      {
        learnerUrlResponse: learnerResponse,
      } as CreateQuestionResponseAttemptRequestDto,
      responseDto,
      context,
      "UrlGradingStrategy-Success",
    );

    return responseDto;
  }

  /**
   * Create a brief summary of the URL content
   */
  private summarizeContent(content: string): string {
    if (!content) return "No content available";

    const preview = content.slice(0, 150).trim();

    return content.length > 150 ? `${preview}...` : preview;
  }

  /**
   * Convert GitHub blob URL to raw content URL
   */
  private convertGitHubUrlToRaw(url: string): string | null {
    const match = url.match(
      /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
    );
    if (!match) {
      return;
    }
    const [, user, repo, path] = match;
    return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
  }

  /**
   * Fetch content from a URL
   */
  private async fetchUrlContent(
    url: string,
  ): Promise<{ body: string; isFunctional: boolean }> {
    const MAX_CONTENT_SIZE = 100_000;
    try {
      if (url.includes("github.com")) {
        if (url.includes("/blob/")) {
          const rawUrl = this.convertGitHubUrlToRaw(url);
          if (!rawUrl) {
            return { body: "", isFunctional: false };
          }

          const rawContentResponse = await axios.get<string>(rawUrl);
          if (rawContentResponse.status === 200) {
            let body = rawContentResponse.data;
            if (body.length > MAX_CONTENT_SIZE) {
              body = body.slice(0, MAX_CONTENT_SIZE);
            }
            return { body, isFunctional: true };
          }
        } else {
          const repoMatch = url.match(
            /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/,
          );
          if (repoMatch) {
            const [, user, repo] = repoMatch;

            const readmeUrl = `https://raw.githubusercontent.com/${user}/${repo}/main/README.md`;
            try {
              const readmeResponse = await axios.get<string>(readmeUrl);
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
                  await axios.get<string>(masterReadmeUrl);
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
                  const apiResponse = await axios.get(apiUrl);
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
                  // Ignore errors
                  return { body: "", isFunctional: false };
                }
              }
            }
          }

          try {
            const response = await axios.get<string>(url);
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
                fileList.each((index, element) => {
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
          } catch (error) {
            console.error("Error fetching GitHub content:", error);
          }
        }

        return { body: "", isFunctional: false };
      } else {
        const response = await axios.get<string>(url);
        const $ = cheerio.load(response.data);

        $("script, style, noscript, iframe, noembed, embed, object").remove();

        const plainText = $("body").text().trim().replaceAll(/\s+/g, " ");

        return { body: plainText, isFunctional: true };
      }
    } catch {
      return { body: "", isFunctional: false };
    }
  }
}
