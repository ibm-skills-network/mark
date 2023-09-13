import { BadRequestException } from "@nestjs/common";
import { QuestionType } from "@prisma/client";
import axios from "axios";
import * as cheerio from "cheerio";
import mammoth from "mammoth";
import { TextBasedQuestionResponseModel } from "../../../llm/model/text.based.question.response.model";
import { CreateQuestionResponseSubmissionRequestDto } from "../dto/question-response/create.question.response.submission.request.dto";
import { TextBasedFeedbackDto } from "../dto/question-response/create.question.response.submission.response.dto";

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

// Create a new class
export const SubmissionHelper = {
  // Converts TextBasedQuestionResponseModel to TextBasedFeedbackDto
  toTextBasedFeedbackDto(
    model: TextBasedQuestionResponseModel
  ): TextBasedFeedbackDto {
    const dto = new TextBasedFeedbackDto();
    dto.points = model.points;
    dto.feedback = model.feedback;
    return dto;
  },

  async validateAndGetTextResponse(
    questionType: QuestionType,
    createQuestionResponseSubmissionRequestDto: CreateQuestionResponseSubmissionRequestDto
  ): Promise<string> {
    if (questionType === QuestionType.TEXT) {
      if (!createQuestionResponseSubmissionRequestDto.learnerTextResponse) {
        throw new BadRequestException(
          "Expected a text-based response (learnerResponse), but did not receive one."
        );
      }
      return createQuestionResponseSubmissionRequestDto.learnerTextResponse;
    }

    if (questionType === QuestionType.URL) {
      if (!createQuestionResponseSubmissionRequestDto.learnerUrlResponse) {
        throw new BadRequestException(
          "Expected a url-based response (learnerUrlResponse), but did not receive one."
        );
      }
      return await this.fetchPlainTextFromUrl(
        createQuestionResponseSubmissionRequestDto.learnerUrlResponse
      );
    }

    if (questionType === QuestionType.UPLOAD) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const file =
        createQuestionResponseSubmissionRequestDto.learnerFileResponse as UploadedFile;
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

  async fetchPlainTextFromUrl(url: string): Promise<string> {
    try {
      const response = await axios.get<string>(url);
      const $ = cheerio.load(response.data);
      return $("body").text().trim(); // Extracts plain text from the body of the webpage
    } catch {
      throw new BadRequestException(`Unable to fetch or parse the URL: ${url}`);
    }
  },
};
