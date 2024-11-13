import { BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import axios from "axios";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
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

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

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

  async fetchPlainTextFromUrl(
    url: string,
  ): Promise<{ body: string; isFunctional: boolean }> {
    try {
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
    } catch (error) {
      console.error(`Unable to fetch or parse the URL: ${url}`, error);
      return { body: "", isFunctional: false };
    }
  },
};
