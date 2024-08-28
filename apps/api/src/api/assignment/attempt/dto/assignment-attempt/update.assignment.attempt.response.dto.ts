import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsOptional } from "class-validator";
import type { CreateQuestionResponseAttemptResponseDto } from "../question-response/create.question.response.attempt.response.dto";
import { BaseAssignmentAttemptResponseDto } from "./base.assignment.attempt.response.dto";

export class UpdateAssignmentAttemptResponseDto extends BaseAssignmentAttemptResponseDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not.",
    type: Boolean,
    example: false,
    required: true,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this attempt.",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;

  @ApiProperty({
    description: "The feedback for each question.",
    isArray: true,
    required: true,
  })
  @IsArray()
  feedbacksForQuestions: CreateQuestionResponseAttemptResponseDto[];

  @ApiProperty({
    description: "The list of question responses for the assignment attempt.",
    type: Boolean,
  })
  @IsOptional()
  showSubmissionFeedback: boolean;
}
