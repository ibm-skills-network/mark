import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidateNested,
} from "class-validator";
import { ScoringDto } from "../../dto/update.questions.request.dto";
import { CustomScoringValidator } from "../custom-validator/scoring.criteria.validator";

export enum ScoringType {
  CRITERIA_BASED = "CRITERIA_BASED",
  LOSS_PER_MISTAKE = "LOSS_PER_MISTAKE",
  AI_GRADED = "AI_GRADED",
}

export class Criteria {
  @IsNumber()
  points: number;
  @IsString()
  description: string;
}
export interface LLMResponseQuestion {
  question: string;
  totalPoints: number;
  type: QuestionType;
  scoring: ScoringDto;
  choices?: {
    choice: string;
    isCorrect: boolean;
    points: number;
    feedback: string;
  }[];
}

export class Choice {
  @IsNotEmpty()
  @IsString()
  choice: string;
  @IsNotEmpty()
  @IsBoolean()
  isCorrect: boolean;
  @IsNotEmpty()
  @IsNumber()
  points: number;
  @IsString()
  @IsOptional()
  feedback: string;
  @IsOptional()
  @IsInt()
  id?: number;
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
  @IsOptional()
  @IsInt()
  maxCharacters?: number;

  @ApiPropertyOptional({
    description: "The scoring criteria.",
    type: () => ScoringDto,
  })
  @IsOptional()
  @Type(() => ScoringDto)
  @ValidateNested()
  @Validate(CustomScoringValidator, [{ alwaysValidate: true }])
  scoring?: ScoringDto;

  @ApiPropertyOptional({
    description:
      'The choices for the question (if the Question Type is "SINGLE_CORRECT" or "MULTIPLE_CORRECT").',
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => Choice)
  choices?: Choice[];

  @ApiPropertyOptional({
    description:
      'The answer for the question (if the Question Type is "TRUE_FALSE").',
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  answer?: boolean | null;
}
