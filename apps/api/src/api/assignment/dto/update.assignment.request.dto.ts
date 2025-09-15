import { ApiProperty } from "@nestjs/swagger";
import {
  AssignmentQuestionDisplayOrder,
  QuestionDisplay,
} from "@prisma/client";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
} from "class-validator";

export class UpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  name: string;
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
      "The number of questions to be displayed per attempt. (null means all questions are displayed)",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  numberOfQuestionsPerAttempt?: number | null;

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
    description: "Show question",
    type: Boolean,
    required: false,
  })
  showQuestions: boolean;
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
    description:
      "Should the correct answer be shown to the learner after its submission",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  showCorrectAnswer: boolean;
}
