import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionType } from "@prisma/client";
import { BaseResponseDto } from "../base.response.dto";

export class GetAssignmentSubmissionQuestionResponseDto extends BaseResponseDto {
  @ApiProperty({
    description: "The ID of the question.",
    type: Number,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "Total points for the question.",
    type: Number,
    required: true,
  })
  totalPoints: number;

  @ApiProperty({
    description: "The number of retries allowed for the assignment.",
    type: Number,
    required: false,
  })
  numRetries: number;

  @ApiProperty({
    description: "Type of the question.",
    enum: QuestionType,
    required: true,
  })
  type: QuestionType;

  @ApiProperty({
    description: "The question content.",
    type: String,
    required: true,
  })
  question: string;

  @ApiPropertyOptional({
    description: "The choices for the question.",
    type: [String],
  })
  choices: string[];
}
