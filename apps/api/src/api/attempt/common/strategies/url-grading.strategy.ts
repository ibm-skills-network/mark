/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/require-await */
import { Injectable, BadRequestException } from "@nestjs/common";
import { LlmFacadeService } from "src/api/llm/llm-facade.service";
import { UrlBasedQuestionEvaluateModel } from "src/api/llm/model/url.based.question.evaluate.model";
import { CreateQuestionResponseAttemptRequestDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.request.dto";
import { CreateQuestionResponseAttemptResponseDto } from "src/api/assignment/attempt/dto/question-response/create.question.response.attempt.response.dto";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import { AttemptHelper } from "src/api/assignment/attempt/helper/attempts.helper";

import axios from "axios";
import * as cheerio from "cheerio";
import { GradingAuditService } from "../../services/question-response/grading-audit.service";
import { GradingContext } from "../interfaces/grading-context.interface";
import { LocalizationService } from "../utils/localization.service";
import { AbstractGradingStrategy } from "./abstract-grading.strategy";

@Injectable()
export class UrlGradingStrategy extends AbstractGradingStrategy<string> {
  constructor(
    private readonly llmFacadeService: LlmFacadeService,
    protected readonly localizationService: LocalizationService,
    protected readonly gradingAuditService: GradingAuditService,
  ) {
    super(localizationService, gradingAuditService);
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

    // Validate URL format if needed
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
    // Try to fetch content from the URL
    let urlFetchResponse: { body: string; isFunctional: boolean };

    try {
      urlFetchResponse = await this.fetchUrlContent(learnerResponse);
    } catch {
      // If our custom fetcher fails, try the AttemptHelper's fetcher as backup
      urlFetchResponse =
        await AttemptHelper.fetchPlainTextFromUrl(learnerResponse);
    }

    // If both fetching methods fail, provide error feedback
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

      return responseDto;
    }

    // Create evaluation model for the LLM
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

    // Use LLM to grade the response
    const gradingModel = await this.llmFacadeService.gradeUrlBasedQuestion(
      urlBasedQuestionEvaluateModel,
      context.assignmentId,
      context.language,
    );

    // Create and populate response DTO
    const responseDto = new CreateQuestionResponseAttemptResponseDto();
    AttemptHelper.assignFeedbackToResponse(gradingModel, responseDto);

    // Add URL-specific metadata
    responseDto.metadata = {
      ...responseDto.metadata,
      url: learnerResponse,
      contentSummary: this.summarizeContent(urlFetchResponse.body),
      contentLength: urlFetchResponse.body.length,
      isGithubRepo: learnerResponse.includes("github.com"),
      gradingRationale:
        gradingModel.gradingRationale || "URL content evaluated",
    };

    return responseDto;
  }

  /**
   * Create a brief summary of the URL content
   */
  private summarizeContent(content: string): string {
    if (!content) return "No content available";

    // Get the first 150 characters
    const preview = content.slice(0, 150).trim();

    // Return the preview with ellipsis if content was truncated
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
        // Handle GitHub repository root URLs
        if (url.includes("/blob/")) {
          // Handle regular GitHub file URLs
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
          // For repository root URLs, fetch the repository metadata or README if available
          try {
            // Extract user and repo from the URL
            const repoMatch = url.match(
              /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/,
            );
            if (repoMatch) {
              const [, user, repo] = repoMatch;

              // Try to fetch the README.md first (most common case)
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
                // README.md might not exist or be on a different branch, try master branch
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
                  // If README fetching failed, get repository info from GitHub API
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
                  } catch (apiError) {
                    console.error("Error fetching repository info:", apiError);
                  }
                }
              }
            }
          } catch (repoError) {
            console.error("Error processing GitHub repository URL:", repoError);
          }

          // If all attempts to get content failed, scrape the GitHub page itself
          try {
            const response = await axios.get<string>(url);
            const $ = cheerio.load(response.data);

            // Remove script tags and other potentially irrelevant elements
            $(
              "script, style, noscript, iframe, noembed, embed, object",
            ).remove();

            // Try to extract the README content if displayed on the page
            let content = "";
            const readmeElement = $("article.markdown-body");
            if (readmeElement.length > 0) {
              content = readmeElement.text().trim();
            } else {
              // Get repository description and other info
              const aboutSection = $(".Box-body");
              if (aboutSection.length > 0) {
                content += aboutSection.text().trim() + "\n\n";
              }

              // Get file listing
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
          } catch (pageError) {
            console.error("Error scraping GitHub page:", pageError);
          }
        }

        return { body: "", isFunctional: false };
      } else {
        const response = await axios.get<string>(url);
        const $ = cheerio.load(response.data);

        // Remove script tags and other potentially irrelevant elements
        $("script, style, noscript, iframe, noembed, embed, object").remove();

        const plainText = $("body")
          .text()
          .trim() // remove spaces from start and end
          .replaceAll(/\s+/g, " "); // replace multiple spaces with a single space

        return { body: plainText, isFunctional: true };
      }
    } catch (error) {
      console.error("Error fetching content from URL:", error);
      return { body: "", isFunctional: false };
    }
  }
}
