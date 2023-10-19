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
    responseDto: CreateQuestionResponseAttemptResponseDto
  ) {
    responseDto.totalPoints = model.points;
    if (model instanceof ChoiceBasedQuestionResponseModel) {
      responseDto.feedback = model.feedback as ChoiceBasedFeedbackDto[];
    } else {
      const generalFeedbackDto = new GeneralFeedbackDto();
      generalFeedbackDto.feedback = model.feedback;
      responseDto.feedback = [generalFeedbackDto];
    }
  },

  async validateAndGetTextResponse(
    questionType: QuestionType,
    createQuestionResponseAttemptRequestDto: CreateQuestionResponseAttemptRequestDto
  ): Promise<string> {
    if (questionType === QuestionType.TEXT) {
      if (!createQuestionResponseAttemptRequestDto.learnerTextResponse) {
        throw new BadRequestException(
          "Expected a text-based response (learnerResponse), but did not receive one."
        );
      }
      return createQuestionResponseAttemptRequestDto.learnerTextResponse;
    }

    if (questionType === QuestionType.UPLOAD) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const file =
        createQuestionResponseAttemptRequestDto.learnerFileResponse as UploadedFile;
      if (!file) {
        throw new BadRequestException(
          "Expected a file-based response (learnerFileResponse), but did not receive one."
        );
      }

      const extension = file.originalname.split(".").pop()?.toLowerCase();
      if (extension === "txt") {
        return file.buffer.toString("utf8");
      } else if (extension === "docx") {
        // Using mammoth to extract text from the docx buffer
        const { value } = await mammoth.extractRawText({ buffer: file.buffer });
        return value;
      } else {
        throw new BadRequestException(
          "Unsupported file type provided. Only .txt and .docx are supported."
        );
      }
    }

    throw new BadRequestException("Unexpected question type received.");
  },

  async fetchPlainTextFromUrl(
    url: string
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
