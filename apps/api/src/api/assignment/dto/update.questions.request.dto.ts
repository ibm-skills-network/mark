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
import { ScoringType } from "../question/dto/create.update.question.request.dto";

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
  id?: number;
}
export class CriteriaDto {
  @ApiProperty({ description: "Description of the criteria", type: String })
  @IsString()
  description: string;

  @ApiProperty({
    description: "Points associated with this criteria",
    type: Number,
  })
  @IsInt()
  points: number;

  @ApiProperty({ description: "ID of the criteria", type: Number })
  @IsInt()
  @IsOptional()
  id?: number;
}
export class RubricDto {
  @ApiProperty({ description: "Rubric Question", type: String })
  @IsString()
  rubricQuestion: string;

  @ApiProperty({
    description: "Criteria for the rubric",
    type: [CriteriaDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CriteriaDto)
  criteria: CriteriaDto[];
}
export class ScoringDto {
  @ApiProperty({
    description: "The type of scoring.",
    type: String,
    enum: ScoringType,
    required: true,
  })
  @IsNotEmpty()
  type: ScoringType;

  @ApiProperty({
    description: "Criteria for scoring",
    type: [RubricDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricDto)
  rubrics: RubricDto[];

  @ApiProperty({
    description: "Show rubric to the learner",
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  showRubricsToLearner?: boolean;

  @ApiProperty({
    description: "Show points to the learner",
    type: Boolean,
  })
  @IsBoolean()
  @IsOptional()
  showPoints?: boolean;
}
export class VariantDto {
  @ApiProperty({ description: "Variant content of the question", type: String })
  @IsString()
  variantContent: string;

  @ApiProperty({
    description: "Flag indicating if variant is deleted",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;

  @ApiProperty({
    description: "Choices for the variant (if applicable)",
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Choice)
  choices?: Choice[];

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

  @ApiPropertyOptional({
    description: "Flag indicating if variant choices are randomized",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  randomizedChoices?: boolean;
}
export interface VideoPresentationConfig {
  evaluateSlidesQuality: boolean;
  evaluateTimeManagement: boolean;
  targetTime: number;
}
export class QuestionDto {
  @ApiProperty({ description: "Question text", type: String })
  @IsString()
  question: string;
  @ApiProperty({
    description: "Grading context question IDs (array of question IDs)",
    type: Number,
    required: false,
  })
  @ApiProperty({
    description: "Flag indicating if question is deleted",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  isDeleted?: boolean;

  @ApiProperty({
    description: "Grading context question IDs (array of question IDs)",
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  gradingContextQuestionIds: number[];
  @ApiProperty({
    description: "translations dictionary",
    type: Object,
  })
  @IsOptional()
  translations?: Record<
    string,
    {
      translatedText: string;
      translatedChoices: Choice[];
    }
  >;
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
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
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

  @ApiPropertyOptional({
    description: "Video presentation configuration",
    type: Object,
  })
  @IsOptional()
  videoPresentationConfig?: VideoPresentationConfig;

  @ApiPropertyOptional({
    description: "Live recording configuration",
    type: Object,
  })
  @IsOptional()
  liveRecordingConfig?: object;
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
    description: "The name of the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  name: string;
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
    description:
      "The number of questions to be answered per attempt. (null means unlimited questions)",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  numberOfQuestionsPerAttempt: number | null;

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
  questionOrder?: number[];

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
    description: "show questions to the learner after its submission",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showQuestions: boolean;

  @ApiProperty({
    description: "updatedAt",
    required: false,
  })
  @IsOptional()
  updatedAt: Date;
}
/**
 * If a questionVariant is present (not null), you can expand this class
 * to match how your code structures variant data.
 */
export class QuestionVariantDataDto {
  @ApiPropertyOptional({ description: "Variant ID", type: Number })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiPropertyOptional({ description: "Variant content", type: String })
  @IsOptional()
  @IsString()
  variantContent?: string;
}
/**
 * DTO for each question variant row in the assignment attempt, including
 * randomized choices JSON and an optional questionVariant object.
 */
export class AttemptQuestionVariantDto {
  @ApiProperty({ description: "AssignmentAttempt ID", type: Number })
  @IsInt()
  assignmentAttemptId: number;

  @ApiProperty({ description: "Question ID", type: Number })
  @IsInt()
  questionId: number;

  @ApiPropertyOptional({
    description: "QuestionVariant ID (if applicable)",
    type: Number,
  })
  @IsOptional()
  @IsInt()
  questionVariantId?: number | null;

  @ApiPropertyOptional({
    description:
      'Randomized choices (JSON string); e.g. \'[{"choice":"...","isCorrect":true},...]\'',
    type: String,
  })
  @IsOptional()
  @IsString()
  randomizedChoices?: string | null;

  @ApiPropertyOptional({
    description: "Full variant object, if it exists",
    type: QuestionVariantDataDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => QuestionVariantDataDto)
  questionVariant?: QuestionVariantDataDto | null;
}
/**
 * Represents a translated version of the question text and choices (if any).
 */
export class AttemptTranslationDto {
  @ApiProperty({ description: "Translated question text", type: String })
  @IsString()
  translatedText: string;

  @ApiPropertyOptional({
    description: "Translated choices (if multiple-choice question)",
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Choice)
  translatedChoices?: Choice[];
}
/**
 * Minimal DTO for each response object (if you store learner answers, etc.).
 * Adjust fields as needed based on your data.
 */
export class AttemptQuestionResponseDto {
  @ApiProperty({ description: "ID of the question answered", type: Number })
  @IsInt()
  questionId: number;

  @ApiPropertyOptional({
    description: "Learner's answer (if textual)",
    type: String,
  })
  @IsOptional()
  @IsString()
  answer?: string | null;

  @ApiPropertyOptional({
    description: "Points awarded for this response",
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  pointsEarned?: number | null;
}

/**
 * Minimal scoring DTO for the final attempt payload.
 * You can expand or reuse your existing ScoringDto.
 */
export class AttemptScoringDto {
  @ApiProperty({
    description: "Scoring type",
    type: String,
    example: "CRITERIA_BASED",
  })
  @IsString()
  type: string;

  @ApiPropertyOptional({
    description: "Whether rubrics are shown to the learner",
    type: Boolean,
  })
  @IsOptional()
  @IsBoolean()
  showRubricsToLearner?: boolean;

  @ApiPropertyOptional({ description: "Rubrics object", type: Object })
  @IsOptional()
  rubrics?: RubricDto[];
}
/**
 * Question DTO in the final payload, including possible translations, choices, etc.
 */
export class AttemptQuestionDto {
  @ApiProperty({ description: "Question ID", type: Number })
  @IsInt()
  id: number;

  @ApiProperty({ description: "Main question text", type: String })
  @IsString()
  question: string;

  @ApiPropertyOptional({
    description: "Array of choices (if MULTIPLE_CHOICE or similar)",
    type: [Choice],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Choice)
  choices?: Choice[];

  @ApiPropertyOptional({
    description: "Dictionary of translations keyed by language code",

    type: Object,
  })
  @IsOptional()
  translations?: Record<string, AttemptTranslationDto>;

  @ApiPropertyOptional({ description: "Max words allowed", type: Number })
  @IsOptional()
  @IsInt()
  maxWords?: number | null;

  @ApiPropertyOptional({ description: "Max characters allowed", type: Number })
  @IsOptional()
  @IsInt()
  maxCharacters?: number | null;

  @ApiPropertyOptional({ description: "Scoring info", type: AttemptScoringDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AttemptScoringDto)
  scoring?: AttemptScoringDto | null;

  @ApiProperty({ description: "Total points", type: Number })
  @IsInt()
  totalPoints: number;

  @ApiProperty({ description: "Question type", type: String })
  @IsString()
  type: string;

  @ApiProperty({ description: "Assignment ID", type: Number })
  @IsInt()
  assignmentId: number;

  @ApiProperty({
    description: "Grading context question IDs (array of question IDs)",
    type: [Number],
  })
  @IsArray()
  @IsInt({ each: true })
  gradingContextQuestionIds: number[];

  @ApiPropertyOptional({ description: "Response type", type: String })
  @IsOptional()
  @IsString()
  responseType?: string | null;

  @ApiProperty({ description: "Is question marked as deleted?", type: Boolean })
  @IsBoolean()
  isDeleted: boolean;

  @ApiPropertyOptional({
    description: "Randomized choices (JSON string) if any",
    type: String,
  })
  @IsOptional()
  @IsString()
  randomizedChoices?: string | null;

  @ApiPropertyOptional({
    description: "Answer to question if its true or false",
    type: String,
  })
  @IsOptional()
  @IsString()
  answer?: string | null;
}
