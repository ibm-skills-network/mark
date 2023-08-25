import { ApiProperty } from "@nestjs/swagger";
import { AssignmentDisplayOrder } from "@prisma/client";
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from "class-validator";

//making properties optional because user might just patch one or two fields
export class UpdateAssignmentRequestDto {
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
    description: "Is the assignment graded or not.",
    type: Boolean,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  graded: boolean;

  @ApiProperty({
    description: "The number of attempts made on the assignment.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  numAttempts: number | null;

  @ApiProperty({
    description: "The allotted time for the assignment.",
    type: Number,
    required: false,
  })
  @IsOptional()
  @IsInt()
  allotedTime: number | null;

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
    enum: AssignmentDisplayOrder,
  })
  @IsOptional()
  @IsEnum(AssignmentDisplayOrder)
  displayOrder: AssignmentDisplayOrder | null;
}
