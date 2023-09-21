import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AdminAddAssignmentToGroupResponseDto {
  @ApiProperty({
    description: "The Id of the assignment.",
    type: Number,
    required: true,
  })
  assignmentId: number;

  @ApiProperty({
    description: "The Id of the group.",
    type: String,
    required: true,
  })
  groupId: string;

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  error?: string;
}
