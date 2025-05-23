import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsOptional, IsString } from "class-validator";
import {
  LearnerFileUpload,
  LearnerPresentationResponse,
} from "../assignment-attempt/types";

export class CreateQuestionResponseAttemptRequestDto {
  @ApiPropertyOptional({
    description: "The learner's text response (for text based questions).",
    type: String,
  })
  @IsOptional()
  @IsString()
  learnerTextResponse: string;

  @ApiPropertyOptional({
    description: "The language code of the learner's response.",
    type: String,
  })
  @IsOptional()
  @IsString()
  language: string;

  @ApiPropertyOptional({
    description: "The learner's url based response (for url based questions).",
    type: String,
  })
  @IsOptional()
  learnerUrlResponse: string;

  @ApiPropertyOptional({
    description: "The learner's choices (for choice based questions).",
    type: [String],
  })
  @IsOptional()
  @IsArray()
  learnerChoices: string[];

  @ApiPropertyOptional({
    description: "The learner's answer choice (for true false questions).",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  learnerAnswerChoice: boolean;

  @ApiPropertyOptional({
    description: "The learner's file response.",
    type: [Object],
  })
  @IsOptional()
  learnerFileResponse?: LearnerFileUpload[];

  @ApiPropertyOptional({
    description: "The learner's presentation response.",
    type: [Object],
  })
  @IsOptional()
  learnerPresentationResponse: LearnerPresentationResponse;

  @ApiPropertyOptional({
    description: "The id of the question.",
    type: Number,
  })
  id: number;
}
