import { ApiProperty } from "@nestjs/swagger";
import {
  IsBoolean,
  IsDate,
  IsDefined,
  IsNumber,
  IsOptional,
} from "class-validator";

export class AdminCreateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
  })
  @IsNumber()
  @IsDefined()
  assignmentId: number;

  @ApiProperty({
    description: "Represents if the learner has submitted this or not",
    type: Boolean,
    example: false,
  })
  @IsBoolean()
  @IsDefined()
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
    type: Boolean,
    example: false,
  })
  @IsDate()
  @IsOptional()
  expiry: Date | null;
}

export class LearnerCreateAnswerSubmissionRequestDto {
  @ApiProperty({
    description: "The ID of the assignment that this submission corresponds to",
    example: 2,
  })
  @IsNumber()
  @IsDefined()
  assignmentId: number;
}
