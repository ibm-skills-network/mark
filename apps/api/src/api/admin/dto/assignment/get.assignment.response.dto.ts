import { ApiProperty } from "@nestjs/swagger";
import { AssignmentType } from "@prisma/client";
import { IsDefined, IsEnum, IsString } from "class-validator";
import { BaseAssignmentResponseDto } from "./base.assignment.response.dto";

export class GetAssignmentResponseDto extends BaseAssignmentResponseDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: true,
  })
  @IsDefined()
  @IsString()
  name: string;

  @ApiProperty({
    description: "The type of the assignment.",
    required: false,
    enum: AssignmentType,
  })
  @IsDefined()
  @IsEnum(AssignmentType)
  type: AssignmentType;
}
