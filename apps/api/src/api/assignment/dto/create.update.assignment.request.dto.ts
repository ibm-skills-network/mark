import { ApiProperty } from "@nestjs/swagger";
import { AssignmentDisplayOrder } from "@prisma/client";
import { IsEnum, IsInt, IsOptional } from "class-validator";

export class CreateUpdateAssignmentRequestDto {
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
