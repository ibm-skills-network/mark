import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class BaseAssignmentAttemptResponseDto {
  @ApiProperty({
    description: "The unique Id of the AssignmentAttempt",
    type: Number,
    required: true,
    example: 1,
  })
  id: number;

  @ApiProperty({
    description: "Indicates if the operation was successful.",
    type: Boolean,
    required: true,
  })
  success: boolean;

  @ApiPropertyOptional({ description: "Optional error message.", type: String })
  error?: string;
}
