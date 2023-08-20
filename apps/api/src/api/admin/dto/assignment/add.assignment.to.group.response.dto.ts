import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AddAssignmentToGroupResponseDto {
  @ApiProperty({
    description: "The ID of the assignment.",
    type: Number,
    required: true,
  })
  assignmentID: number;

  @ApiProperty({
    description: "The ID of the group.",
    type: String,
    required: true,
  })
  groupID: string;

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  error?: string;
}
