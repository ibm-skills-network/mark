import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Validate,
} from "class-validator";
import { CustomScoringValidator } from "../custom-validator/scoring.criteria.validator";

export enum ScoringType {
  CRITERIA_BASED = "CRITERIA_BASED",
  LOSS_PER_MISTAKE = "LOSS_PER_MISTAKE",
  AI_GRADED = "AI_GRADED",
}

export type Criteria = Record<string, unknown>;

export class Scoring {
  @ApiProperty({
    description: "The type of scoring.",
    type: String,
    enum: ScoringType,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(ScoringType)
  type: ScoringType;

  @ApiPropertyOptional({
    description:
      'The scoring criteria. (Not required only if type is "AI_GRADED").',
    type: Object,
    additionalProperties: true,
  })
  criteria: Criteria | null;
}

export class CreateUpdateQuestionRequestDto {
  @ApiProperty({
    description: "Total points for the question.",
    type: Number,
    required: true,
  })
  @IsNotEmpty()
  @IsInt()
  totalPoints: number;

  @ApiProperty({
    description: "The number of retries allowed for this question.",
    type: Number,
    required: false,
  })
  @IsInt()
  numRetries: number;

  @ApiProperty({
    description: "Type of the question.",
    enum: QuestionType,
    required: true,
  })
  @IsNotEmpty()
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({
    description: "The question content.",
    type: String,
    required: true,
  })
  @IsNotEmpty()
  @IsString()
  question: string;

  @ApiProperty({
    description: "The max number of words allowed for this question.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  maxWords?: number;

  @ApiPropertyOptional({ description: "The scoring criteria.", type: Scoring })
  @IsOptional()
  @Type(() => Scoring)
  @Validate(CustomScoringValidator, [{ alwaysValidate: true }])
  scoring?: Scoring;

  @ApiPropertyOptional({
    description:
      'The choices for the question (if the Question Type is "SINGLE_CORRECT" or "MULTIPLE_CORRECT").',
    type: Object,
    additionalProperties: { type: "boolean" },
  })
  @IsOptional()
  @IsObject()
  choices?: Record<string, boolean>;

  @ApiPropertyOptional({
    description:
      'The answer for the question (if the Question Type is "TRUE_FALSE").',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  answer: boolean | null;
}
