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
import * as cheerio from "cheerio";
import { WINSTON_MODULE_PROVIDER } from "nest-winston";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { safeGet } from "src/api/attempt/common/utils/ssrf-safe-http";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { UrlBasedQuestionResponseModel } from "src/api/llm/model/url.based.question.response.model";
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
    try {
      const urlResponse =
        typeof requestDto.learnerUrlResponse === "string"
          ? requestDto.learnerUrlResponse.trim()
          : "";

      if (!urlResponse) {
        throw new BadRequestException(
          this.localizationService?.getLocalizedString?.(
            "expectedUrlResponse",
            requestDto.language,
          ) || "Expected a URL response, but did not receive one.",
        );
      }

      // URL *format* validity is intentionally NOT a hard gate here. Throwing
      // at validation time fails the entire grading job and leaves the
      // learner's attempt ungraded (observed in prod: "Failed to process
      // question response: Invalid URL: script.js"). An unparseable URL is
      // instead graded 0-with-feedback in gradeResponse (see the invalid-URL
      // guard there), so the learner still gets a score + feedback and LMS
      // sync proceeds. Presence/type is still enforced above.
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        "URL validation failed due to system error",
      );
    }
  }

  /**
   * Extract the URL response from the request
   */
  async extractLearnerResponse(
    requestDto: CreateQuestionResponseAttemptRequestDto,
  ): Promise<string> {
    if (typeof requestDto.learnerUrlResponse !== "string") {
      throw new BadRequestException("URL response must be a string");
    }
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
    // Guard: an unparseable URL is a learner input error, not a system
    // failure. Grade it 0 with feedback and skip the fetch/LLM path entirely
    // (mirrors the unfetchable-URL branch below). validateResponse lets
    // invalid formats through on purpose so they are graded here rather than
    // failing the job.
    if (!this.isParseableUrl(learnerResponse)) {
      const responseDto = this.createResponseDto(0, [
        {
          feedback:
            this.localizationService?.getLocalizedString?.(
              "invalidUrl",
              context.language,
              { url: learnerResponse },
            ) || `Invalid URL: ${learnerResponse}`,
        },
      ]);

      responseDto.metadata = {
        error: "invalid_url",
        url: learnerResponse,
        status: "error",
        maxPossiblePoints: question.totalPoints,
      };

      await this.recordGrading(
        question,
        {
          learnerUrlResponse: learnerResponse,
        } as CreateQuestionResponseAttemptRequestDto,
        responseDto,
        context,
        "UrlGradingStrategy-InvalidUrl",
      );

      return responseDto;
    }

    let urlFetchResponse: { body: string; isFunctional: boolean };

    try {
      urlFetchResponse = await this.fetchUrlContent(learnerResponse);
    } catch {
      try {
        urlFetchResponse =
          await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
      } catch {
        return this.createFallbackResponse(
          question,
          learnerResponse,
          context,
          "url_fetch_completely_failed",
        );
      }
    }

    if (!urlFetchResponse.isFunctional) {
      const responseDto = this.createResponseDto(0, [
        {
          feedback:
            this.localizationService?.getLocalizedString?.(
              "unableToFetchUrl",
              context.language,
              { url: learnerResponse },
            ) || `Unable to fetch content from URL: ${learnerResponse}`,
        },
      ]);

      responseDto.metadata = {
        error: "url_fetch_failed",
        url: learnerResponse,
        status: "error",
        maxPossiblePoints: question.totalPoints,
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

    let gradingModel: UrlBasedQuestionResponseModel;
    try {
      gradingModel = await this.llmFacadeService.gradeUrlBasedQuestion(
        urlBasedQuestionEvaluateModel,
        context.assignmentId,
        context.language,
      );
    } catch {
      return this.createFallbackResponse(
        question,
        learnerResponse,
        context,
        "llm_grading_failed",
      );
    }

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
      maxPossiblePoints: question.totalPoints,
    };

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
   * Create a fallback response when URL grading fails
   */
  private createFallbackResponse(
    question: QuestionDto,
    learnerResponse: string,
    context: GradingContext,
    errorType: string,
  ): CreateQuestionResponseAttemptResponseDto {
    const maxPoints = question.totalPoints || 0;
    const fallbackPoints = maxPoints > 0 ? Math.floor(maxPoints * 0.5) : 0;

    const errorMessages: Record<string, string> = {
      url_fetch_completely_failed: "Unable to access the provided URL",
      llm_grading_failed: "Automated grading service temporarily unavailable",
    };

    const errorMessage = errorMessages[errorType] || "Technical error occurred";

    const responseDto = this.createResponseDto(fallbackPoints, [
      {
        feedback: `${errorMessage}. Partial credit (${fallbackPoints}/${maxPoints}) awarded pending manual review. URL submitted: ${learnerResponse}`,
      },
    ]);

    responseDto.metadata = {
      error: errorType,
      url: learnerResponse,
      status: "fallback_grading",
      fallbackReason: errorMessage,
      requiresManualReview: true,
      maxPossiblePoints: question.totalPoints,
    };

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
   * Whether a learner response parses as an absolute URL. Used to short-
   * circuit invalid submissions to a graded-0 response instead of throwing.
   */
  private isParseableUrl(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
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

          const rawContentResponse = await safeGet<string>(rawUrl);
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
                  return { body: "", isFunctional: false };
                }
              }
            }
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
            this.logger?.error("Error fetching GitHub content", {
              url,
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          }
        }

        return { body: "", isFunctional: false };
      } else {
        const response = await safeGet<string>(url);
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
