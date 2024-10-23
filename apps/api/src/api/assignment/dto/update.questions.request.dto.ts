import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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

  @ApiProperty({ description: "Type of question", type: String })
  @IsString()
  type: string;

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
  alreadyInBackend: boolean;

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

  //
}
