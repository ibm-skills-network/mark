import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionResponse, QuestionType } from "@prisma/client";
import { Type } from "class-transformer";
import { Choice } from "../../../../../api/assignment/question/dto/create.update.question.request.dto";

export class AssignmentAttemptResponseDto {
  @ApiProperty({
    description: "The unique Id of the AssignmentAttempt",
    type: Number,
    example: 1,
    required: true,
  })
  id: number;

  @ApiProperty({
    description: "The Id of the assignment that this attempt corresponds to",
    type: Number,
    example: 2,
    required: true,
  })
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this attempt",
    type: Number,
    example: 0.8,
    required: false,
  })
  grade: number | null;

  @ApiProperty({
    description:
      "The DateTime at which the attempt window ends (can no longer submit it)",
    type: Date,
    example: "2023-12-31T23:59:59Z",
    required: false,
  })
  expiresAt: Date | null;
}

export class GetAssignmentAttemptResponseDto extends AssignmentAttemptResponseDto {
  @ApiProperty({
    description:
      "The list of questions for the assignment that this attempt corresponds to with learner's responses",
    isArray: true,
  })
  questions: AssignmentAttemptQuestions[];
  @ApiProperty({
    description: "Passing grade for the assignment",
    type: Number,
    required: true,
  })
  passingGrade: number;
}

export class AssignmentAttemptQuestions {
  @ApiProperty({
    description: "The Id of the question.",
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
    description:
      'The choices for the question (if the Question Type is "SINGLE_CORRECT" or "MULTIPLE_CORRECT").',
    type: [Choice], // Use an array of Choice
  })
  @Type(() => Choice)
  choices?: Choice[];

  @ApiPropertyOptional({
    description: "The max number of words allowed for this question.",
    type: Number,
    required: false,
  })
  maxWords?: number;

  @ApiPropertyOptional({
    description: "The max number of characters allowed for this question.",
    type: Number,
    required: false,
  })
  maxCharacters?: number;

  @ApiProperty({
    description:
      "The list of responses provided by the learner for this question",
    isArray: true,
  })
  questionResponses: QuestionResponse[];
}
