import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  AssignmentQuestionDisplayOrder,
  QuestionDisplay,
  QuestionType,
  ResponseType,
} from "@prisma/client";
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

  //randomizedChoices for the variant
  @ApiPropertyOptional({
    description: "Flag indicating if variant choices are randomized",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  randomizedChoices?: boolean;
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

  @ApiPropertyOptional({
    description: "Flag indicating if the question choices are randomized",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  randomizedChoices?: boolean;
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
    description: "Array of questions",
    required: true,
    type: [QuestionDto],
  })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions: QuestionDto[];

  @ApiProperty({
    description: "The introduction of the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  introduction: string | null;

  @ApiProperty({
    description: "The instructions of the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  instructions: string | null;

  @ApiProperty({
    description: "The grading criteria overiew for the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  gradingCriteriaOverview: string | null;

  @ApiProperty({
    description:
      "Estimated time it will take to complete the assignment in minutes.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  timeEstimateMinutes: number | null;

  @ApiProperty({
    description: "Is the assignment graded or not.",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  graded: boolean;

  @ApiProperty({
    description:
      "The max number of attempts allowed for this assignment. (null means unlimited attempts)",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  numAttempts: number | null;

  @ApiProperty({
    description:
      "The allotted time for the assignment. (null means unlimited time)",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  allotedTimeMinutes?: number | null;

  @ApiProperty({
    description: "Number of allowed attempts within the specified time range.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  attemptsPerTimeRange: number | null;

  @ApiProperty({
    description: "Time range, in hours, over which the attempts are counted.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  attemptsTimeRangeHours: number | null;

  @ApiProperty({
    description: "The passing grade for the assignment.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  passingGrade: number | null;

  @ApiProperty({
    description: "The display order of the assignment.",
    required: false,
    enum: AssignmentQuestionDisplayOrder,
  })
  @IsOptional()
  @IsEnum(AssignmentQuestionDisplayOrder)
  displayOrder: AssignmentQuestionDisplayOrder | null;

  @ApiProperty({
    description: "The display order of the assignment.",
    required: false,
    enum: QuestionDisplay,
  })
  @IsOptional()
  @IsEnum(QuestionDisplay)
  questionDisplay: QuestionDisplay | null;

  @ApiProperty({
    description: "Is the assignment published or not.",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  published: boolean;

  @ApiProperty({
    description: "Array of questionIds used for ordering of the questions",
    type: [Number],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsNumber({}, { each: true })
  questionOrder: number[];

  @ApiProperty({
    description:
      "Should the assignment score be shown to the learner after its submission",
    type: Boolean,
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  showAssignmentScore: boolean;

  @ApiProperty({
    description:
      "Should the question score be shown to the learner after its submission",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showQuestionScore: boolean;

  @ApiProperty({
    description:
      "Should the AI provide feedback when the learner submits a question",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showSubmissionFeedback: boolean;

  @ApiProperty({
    description: "updatedAt",
    required: false,
  })
  @IsOptional()
  updatedAt: Date;
}
