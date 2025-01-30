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
    return;
  }
  const [, user, repo, path] = match;
  return `https://raw.githubusercontent.com/${user}/${repo}/${path}`;
}
