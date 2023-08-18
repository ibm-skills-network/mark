import { ApiProperty } from "@nestjs/swagger";
import {
  Equals,
  IsBoolean,
  IsDate,
  IsDefined,
  IsNumber,
  IsOptional,
} from "class-validator";

export class AdminUpdateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  submitted: boolean;

  @ApiProperty({
    description:
      "The overall LTI grade value (from 0.0 - 1.0) that the learner earned for this submission",
    type: Number,
    example: 0.8,
    required: false,
  })
  @IsNumber()
  @IsOptional()
  grade: number | null;

  @ApiProperty({
    description:
      "The DateTime at which the submission window ends (can no longer submit it)",
    type: Date,
    example: false,
    required: false,
  })
  @IsDate()
  @IsOptional()
  expiry: Date | null;
}

export class LearnerUpdateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: true,
  })
  @IsBoolean()
  @IsDefined()
  @Equals(true, { message: "submitted must be true" })
  submitted: boolean;
}
