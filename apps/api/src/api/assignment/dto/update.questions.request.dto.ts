import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { QuestionType, ResponseType } from "@prisma/client";
import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from "class-validator";

export enum VariantType {
  REWORDED = "REWORDED",
  RANDOMIZED = "RANDOMIZED",
  DIFFICULTY_ADJUSTED = "DIFFICULTY_ADJUSTED",
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
}
class CriteriaDto {
  @ApiProperty({ description: "Description of the criteria", type: String })
  @IsString()
  description: string;

  @ApiProperty({
    description: "Points associated with this criteria",
    type: Number,
  })
  @IsInt()
  points: number;
}
class ScoringDto {
  @ApiProperty({ description: "Type of scoring", type: String })
  @IsString()
  type: string;

  @ApiProperty({
    description: "Criteria for scoring",
    type: [CriteriaDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CriteriaDto)
  criteria: CriteriaDto[];
}
export class VariantDto {
  @ApiProperty({ description: "Variant content of the question", type: String })
  @IsString()
  variantContent: string;

  @ApiProperty({
    description: "Choices for the variant (if applicable)",
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Choice)
  choices?: Choice[];

  //scoring
  @ApiPropertyOptional({
    description: "Scoring configuration",
    type: ScoringDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScoringDto)
  scoring?: ScoringDto;

  @ApiPropertyOptional({ description: "Maximum words allowed", type: Number })
  @IsOptional()
  @IsInt()
  maxWords?: number;

  @ApiPropertyOptional({
    description: "Maximum characters allowed",
    type: Number,
  })
  @IsOptional()
  @IsInt()
  maxCharacters?: number;

  @ApiProperty({ description: "ID of the variant", type: Number })
  @IsInt()
  id: number;

  @ApiProperty({ description: "Variant type", enum: VariantType })
  @IsNotEmpty()
  @IsString()
  variantType: VariantType;
}

export class QuestionDto {
  @ApiProperty({ description: "Question text", type: String })
  @IsString()
  question: string;

  @ApiProperty({
    description: "Flag indicating if question has an answer",
    type: Boolean,
  })
  @IsOptional()
  answer?: boolean | null;

  @ApiProperty({ description: "Total points for the question", type: Number })
  @IsOptional()
  @IsInt()
  @ValidateIf((o: QuestionDto) => o.type !== "MULTIPLE_CORRECT")
  totalPoints?: number;

  @ApiProperty({ description: "Number of retries allowed", type: Number })
  @IsOptional()
  @IsInt()
  numRetries?: number;

  @ApiProperty({ description: "Response Question Type", type: String })
  @IsString()
  @IsOptional()
  responseType?: ResponseType;

  @ApiProperty({ description: "Type of question", type: String })
  @IsString()
  type: QuestionType;

  @ApiProperty({ description: "Max words allowed", type: Number })
  @IsOptional()
  @IsInt()
  maxWords?: number;

  @ApiProperty({ description: "Max characters allowed", type: Number })
  @IsOptional()
  @IsInt()
  maxCharacters?: number;

  @ApiProperty({ description: "Scoring configuration", type: ScoringDto })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ScoringDto)
  scoring?: ScoringDto | null;

  @ApiProperty({ description: "ID of the question", type: Number })
  @IsInt()
  id: number;

  @ApiProperty({ description: "Assignment ID", type: Number })
  @IsInt()
  assignmentId: number;

  @ApiProperty({
    description: "Flag indicating if question is already in backend",
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  alreadyInBackend?: boolean;

  @ApiPropertyOptional({
    description:
      'The choices for the question (if the Question Type is "SINGLE_CORRECT" or "MULTIPLE_CORRECT").',
    type: [Choice], // Use an array of Choice
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true }) // Validate each item in the array
  @Type(() => Choice)
  choices?: Choice[];

  @ApiPropertyOptional({
    description: "Optional success message.",
    type: String,
  })
  @IsOptional()
  @IsString()
  success?: boolean;

  @ApiProperty({
    description:
      "Variants of the question for reworded or difficulty-based changes",
    type: [VariantDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants?: VariantDto[];
}
export class GenerateQuestionVariantDto {
  @ApiProperty({
    description: "Question object",
    type: QuestionDto,
  })
  @ValidateNested()
  @Type(() => QuestionDto)
  questions: QuestionDto[];
  @ApiProperty({
    description: "Number of variants",
    type: Number,
  })
  @IsInt()
  @IsOptional()
  questionVariationNumber: number;
}
export class UpdateAssignmentQuestionsDto {
  @ApiProperty({
    description: "Array of questions for the assignment",
    type: [Object],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];
}
