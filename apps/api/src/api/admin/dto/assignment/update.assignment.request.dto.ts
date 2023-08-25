import { ApiProperty } from "@nestjs/swagger";
import { AssignmentType } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";

export class AdminUpdateAssignmentRequestDto {
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
}
