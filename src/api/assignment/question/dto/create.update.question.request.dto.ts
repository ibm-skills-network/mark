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
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
import { CustomScoringValidator } from "../custom-validator/scoring.criteria.validator";

export enum ScoringType {
  SINGLE_CRITERIA = "SINGLE_CRITERIA",
  MULTIPLE_CRITERIA = "MULTIPLE_CRITERIA",
  LOSS_PER_MISTAKE = "LOSS_PER_MISTAKE",
  AI_GRADED = "AI_GRADED",
}

export type Criteria = Record<string, unknown>;

export class Scoring {
  @IsNotEmpty()
  @IsEnum(ScoringType)
  type: ScoringType;

  @Validate(CustomScoringValidator, [""])
  criteria: Criteria | null;
}

export class CreateUpdateQuestionRequestDto {
  @IsNotEmpty()
  @IsInt()
  totalPoints: number;

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  @IsNotEmpty()
  @IsEnum(QuestionType)
  type: QuestionType;

  @IsNotEmpty()
  @IsString()
  question: string;

  @IsOptional()
  @Type(() => Scoring)
  @ValidateNested()
  scoring?: Scoring;

  @IsOptional()
  @IsObject()
  choices?: Record<string, boolean>;

  @IsOptional()
  @IsBoolean()
  answer: boolean | null;
}
