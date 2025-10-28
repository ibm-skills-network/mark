import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  Equals,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { QuestionDto } from "src/api/assignment/dto/update.questions.request.dto";
import type { CreateQuestionResponseAttemptRequestDto } from "../question-response/create.question.response.attempt.request.dto";

export type QuestionResponse = CreateQuestionResponseAttemptRequestDto & {
  id: number;
  question: string;
};

export class authorAssignmentDetailsDTO {
  @IsEnum(["ONE_PER_PAGE", "ALL_PER_PAGE"])
  questionDisplay: "ONE_PER_PAGE" | "ALL_PER_PAGE";
  @IsBoolean()
  graded: boolean;
  @IsInt()
  @IsOptional()
  numAttempts: number | null;
  @IsInt()
  passingGrade: number;
  @IsInt()
  @IsOptional()
  allotedTimeMinutes?: number;
  @IsEnum(["DEFINED", "RANDOM"])
  displayOrder: "DEFINED" | "RANDOM";
  @IsBoolean()
  strictTimeLimit: boolean;
  @IsString()
  introduction: string;
  @IsString()
  instructions: string;
}

export class LearnerUpdateAssignmentAttemptRequestDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  @IsDefined()
  @Equals(true, { message: "submitted must be true" })
  submitted: boolean;

  @ApiProperty({
    description: "The list of question responses for the assignment attempt",
    isArray: true,
    required: true,
  })
  @IsArray()
  @IsDefined()
  responsesForQuestions: QuestionResponse[];
  @ApiProperty({
    description: "questions from author",
    required: false,
  })
  @IsString()
  @IsOptional()
  @ApiProperty({
    description: "The language the user prefers",
    required: false,
  })
  language?: string;
  @IsArray()
  @IsOptional()
  authorQuestions?: QuestionDto[];
  @ApiProperty({
    description: "assignment details from author",
    required: false,
  })
  @ValidateNested()
  @Type(() => authorAssignmentDetailsDTO)
  @IsOptional()
  authorAssignmentDetails?: authorAssignmentDetailsDTO;

  @ApiProperty({
    description: "Pre-translated questions",
    required: false,
  })
  @IsArray()
  @IsOptional()
  preTranslatedQuestions?: Map<number, QuestionDto>;

  @ApiProperty({
    description: "The expiration date of the assignment attempt",
    type: Date,
    required: false,
  })
  @IsOptional()
  expiresAt?: Date;
}
