import { ApiProperty } from "@nestjs/swagger";
import { Assignment, AssignmentType } from "@prisma/client";
import { BaseAssignmentResponseDto } from "./base.assignment.response.dto";

export class AdminGetAssignmentResponseDto extends BaseAssignmentResponseDto {
  @ApiProperty({
    description: "The name of the assignment.",
    type: String,
    required: true,
  })
  name: string;

  @ApiProperty({
    description: "The type of the assignment.",
    required: false,
    enum: AssignmentType,
  })
  type: AssignmentType;
  @ApiProperty({
    description: "The full assignment object",
    required: true,
  })
  metadata: Assignment;
}
