import { ApiProperty } from "@nestjs/swagger";
import { AssignmentDisplayOrder, AssignmentType } from "@prisma/client";
import { IsEnum, IsInt, IsOptional, IsString } from "class-validator";

export class CreateUpdateAssignmentRequestDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: false,
  })
  @IsOptional()
  @IsString()
  name: string | null;

  @ApiProperty({
    description: "The type of the assignment.",
    required: false,
    enum: AssignmentType,
  })
  @IsOptional()
  @IsEnum(AssignmentType)
  type: AssignmentType | null;

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
