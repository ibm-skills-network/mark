import { ApiProperty } from "@nestjs/swagger";
import { AssignmentDisplayOrder, GradingType } from "@prisma/client";
import {
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from "class-validator";

//making all those properties mandatory that are mandatory on UI side (to ensure backend validation of those as well)
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
  instructions: string;

  @ApiProperty({
    description: "The grading type of the assignment.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  gradingType: GradingType;

  @ApiProperty({
    description: "The number of attempts made on the assignment.",
    type: Number,
    required: true,
  })
  @IsDefined()
  @IsInt()
  numAttempts: number;

  @ApiProperty({
    description: "The allotted time for the assignment.",
    type: Number,
    required: true,
  })
  @IsDefined()
  @IsInt()
  allotedTime: number;

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
    enum: AssignmentDisplayOrder,
  })
  @IsOptional()
  @IsEnum(AssignmentDisplayOrder)
  displayOrder: AssignmentDisplayOrder;
}
