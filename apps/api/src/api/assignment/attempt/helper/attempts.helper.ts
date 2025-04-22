/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import axios from "axios";
import * as cheerio from "cheerio";
import { ChoiceBasedQuestionResponseModel } from "../../../../api/llm/model/choice.based.question.response.model";
import { TextBasedQuestionResponseModel } from "../../../../api/llm/model/text.based.question.response.model";
import { TrueFalseBasedQuestionResponseModel } from "../../../../api/llm/model/true.false.based.question.response.model";
import { UrlBasedQuestionResponseModel } from "../../../../api/llm/model/url.based.question.response.model";
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
      | TrueFalseBasedQuestionResponseModel,
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
    } else {
      const generalFeedbackDto = new GeneralFeedbackDto();
      generalFeedbackDto.feedback = model.feedback;
      responseDto.feedback = [generalFeedbackDto];
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
      const index_ = Math.floor(Math.random() * (index + 1)); // Pick a random index
      [array[index], array[index_]] = [array[index_], array[index]]; // Swap elements
    }
    return array;
  },
  async fetchPlainTextFromUrl(
    url: string,
  ): Promise<{ body: string; isFunctional: boolean }> {
    const MAX_CONTENT_SIZE = 100_000;
    try {
      if (url.includes("github.com")) {
        // Handle GitHub repository root URLs
        if (url.includes("/blob/")) {
          // Handle regular GitHub file URLs
          const rawUrl = convertGitHubUrlToRaw(url);
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
          // eslint-disable-next-line unicorn/prefer-string-replace-all
          .replace(/\s+/g, " "); // replace multiple spaces with a single space

        return { body: plainText, isFunctional: true };
      }
    } catch (error) {
      console.error("Error fetching content from URL:", error);
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
    return null; // Fixed: Return null instead of undefined
  }
  const [, user, repo, path] = match;
  return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
}
