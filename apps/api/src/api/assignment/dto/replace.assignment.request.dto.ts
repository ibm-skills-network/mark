import { ApiProperty } from "@nestjs/swagger";
import { AssignmentQuestionDisplayOrder } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from "class-validator";

export class ReplaceAssignmentRequestDto {
  @ApiProperty({
    description: "The introduction of the assignment.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  introduction: string;

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
    required: true,
  })
  @IsDefined()
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
    required: true,
  })
  @IsDefined()
  @IsInt()
  passingGrade: number;

  @ApiProperty({
    description: "The display order of the assignment.",
    required: false,
    enum: AssignmentQuestionDisplayOrder,
  })
  @IsOptional()
  @IsEnum(AssignmentQuestionDisplayOrder)
  displayOrder: AssignmentQuestionDisplayOrder | null;

  @ApiProperty({
    description: "Is the assignment published or not.",
    type: Boolean,
    required: true,
  })
  @IsDefined()
  @IsBoolean()
  published: boolean;

  @ApiProperty({
    description: "Array of questionIds used for ordering of the questions",
    type: [Number],
    required: false,
  })
  @IsDefined()
  @IsArray()
  questionOrder: number[];
}
