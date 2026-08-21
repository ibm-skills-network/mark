import { ApiProperty } from "@nestjs/swagger";
import {
  AssignmentQuestionDisplayOrder,
  CorrectAnswerVisibility,
  QuestionDisplay,
  QuestionType,
  ResponseType,
} from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

class ChoiceDto {
  @ApiProperty()
  @IsString()
  choice: string;

  @ApiProperty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsBoolean()
  isCorrect: boolean;

  @ApiProperty()
  @IsNumber()
  points: number;

  @ApiProperty()
  @IsString()
  feedback: string;
}

class RubricCriterionDto {
  @ApiProperty()
  @IsInt()
  id: number;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty()
  @IsNumber()
  points: number;
}

class RubricDto {
  @ApiProperty()
  @IsString()
  rubricQuestion: string;

  @ApiProperty({ type: [RubricCriterionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  criteria: RubricCriterionDto[];
}

class ScoringDto {
  @ApiProperty({ type: [RubricDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RubricDto)
  rubrics: RubricDto[];

  @ApiProperty()
  @IsString()
  type: string;

  @ApiProperty()
  @IsBoolean()
  showSubQuestionsToLearner: boolean;

  @ApiProperty()
  @IsBoolean()
  showPoints: boolean;

  @ApiProperty()
  @IsBoolean()
  showRubricsToLearner: boolean;
}

class QuestionContentDto {
  @ApiProperty({ enum: QuestionType })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty()
  @IsString()
  question: string;

  @ApiProperty({ enum: ResponseType })
  @IsEnum(ResponseType)
  responseType: ResponseType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  maxWords?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  maxCharacters?: number | null;

  @ApiProperty()
  @IsNumber()
  totalPoints: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  randomizedChoices?: boolean | null;

  @ApiProperty({ type: [ChoiceDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChoiceDto)
  choices?: ChoiceDto[];

  @ApiProperty({ type: ScoringDto, required: false })
  @IsOptional()
  @ValidateNested()
  @Type(() => ScoringDto)
  scoring?: ScoringDto;
}

class AssignmentDetailsDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty()
  @IsString()
  introduction: string;

  @ApiProperty()
  @IsString()
  instructions: string;
}

class AssignmentConfigDto {
  @ApiProperty()
  @IsInt()
  numAttempts: number;

  @ApiProperty()
  @IsInt()
  attemptsBeforeCoolDown: number;

  @ApiProperty()
  @IsInt()
  retakeAttemptCoolDownMinutes: number;

  @ApiProperty()
  @IsInt()
  passingGrade: number;

  @ApiProperty({ enum: AssignmentQuestionDisplayOrder })
  @IsEnum(AssignmentQuestionDisplayOrder)
  displayOrder: AssignmentQuestionDisplayOrder;

  @ApiProperty()
  @IsBoolean()
  graded: boolean;

  @ApiProperty()
  @IsInt()
  questionVariationNumber: number;

  @ApiProperty({ enum: QuestionDisplay })
  @IsEnum(QuestionDisplay)
  questionDisplay: QuestionDisplay;

  @ApiProperty()
  @IsBoolean()
  showQuestions: boolean;

  @ApiProperty()
  @IsBoolean()
  showSubmissionFeedback: boolean;

  @ApiProperty()
  @IsBoolean()
  showAssignmentScore: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  numberOfQuestionsPerAttempt?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  timeEstimateMinutes?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  allotedTimeMinutes?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  attemptsPerTimeRange?: number | null;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  attemptsTimeRangeHours?: number | null;

  @ApiProperty()
  @IsBoolean()
  showQuestionScore: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showPassFailIndicator?: boolean;

  @ApiProperty({ enum: CorrectAnswerVisibility })
  @IsEnum(CorrectAnswerVisibility)
  correctAnswerVisibility: CorrectAnswerVisibility;

  @ApiProperty({ required: false })
  @IsOptional()
  currentVersion?: any;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsArray()
  versions?: any[];
}

class FeedbackConfigDto {
  @ApiProperty()
  @IsString()
  verbosityLevel: string;

  @ApiProperty()
  @IsBoolean()
  showSubmissionFeedback: boolean;

  @ApiProperty()
  @IsBoolean()
  showQuestionScore: boolean;

  @ApiProperty()
  @IsBoolean()
  showAssignmentScore: boolean;

  @ApiProperty()
  @IsBoolean()
  showQuestions: boolean;
}

export class AdminAddContentToAssignmentRequestDto {
  @ApiProperty({ type: AssignmentDetailsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AssignmentDetailsDto)
  assignment: AssignmentDetailsDto;

  @ApiProperty({ type: AssignmentConfigDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => AssignmentConfigDto)
  config: AssignmentConfigDto;

  @ApiProperty({ type: FeedbackConfigDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => FeedbackConfigDto)
  feedbackConfig: FeedbackConfigDto;

  @ApiProperty()
  @IsString()
  gradingCriteria: string;

  @ApiProperty({ type: [QuestionContentDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionContentDto)
  questions: QuestionContentDto[];
}
